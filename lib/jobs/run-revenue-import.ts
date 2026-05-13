import { getDatabase } from '../mongodb';
import { parseGygCsv, isGygCsv } from '../parsers/gyg';
import { analyzeBookingCsv, completeBookingParse, isBookingCsv } from '../parsers/booking';
import { parseTiqetsCsv, isTiqetsCsv } from '../parsers/tiqets';
import { parseDiscoverCarsCsv, isDiscoverCarsCsv } from '../parsers/discovercars';
import { parseSendowlCsv, isSendowlCsv } from '../parsers/sendowl';
import { getCsvHeaders } from '../parsers/csv-utils';
import { recalculateBookingCommissions } from '../booking-recalculate';
import { buildAffiliateMaps } from '../affiliate-maps';
import type { AffiliationPartner, AffiliationRevenue } from '../models/revenue';

export function detectRevenuePartnerFromHeaders(headers: string[]): AffiliationPartner | null {
  if (isGygCsv(headers)) return 'getyourguide';
  if (isTiqetsCsv(headers)) return 'tiqets';
  if (isSendowlCsv(headers)) return 'sendowl';
  if (isDiscoverCarsCsv(headers)) return 'discovercars';
  if (isBookingCsv(headers)) return 'booking';
  return null;
}

export interface RevenueImportInput {
  text: string;
  /** Si absent ou null : détection automatique via les en-têtes CSV */
  partner?: AffiliationPartner | null;
}

export type RevenueImportResponse =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 422; body: Record<string, unknown> };

/**
 * Parse, importe en base et retourne le même JSON que l’historique POST /api/revenue/import.
 */
export async function runRevenueCsvImport(input: RevenueImportInput): Promise<RevenueImportResponse> {
  const text = input.text;
  if (!text.trim()) {
    return { ok: false, status: 422, body: { error: 'Le fichier est vide' } };
  }

  const headers = getCsvHeaders(text);
  const partner = input.partner ?? detectRevenuePartnerFromHeaders(headers);

  if (!partner) {
    return {
      ok: false,
      status: 422,
      body: {
        error: 'Partenaire non reconnu. Veuillez sélectionner le partenaire manuellement.',
        detectedHeaders: headers,
      },
    };
  }

  let result: {
    records: Omit<AffiliationRevenue, '_id'>[];
    skipped: number;
    errors: string[];
    unmappedProducts?: string[];
    checkInMonths?: string[];
    detectedColumns?: string[];
  };

  const db = await getDatabase();
  const affiliateMaps = await buildAffiliateMaps(db);

  if (partner === 'getyourguide') {
    result = parseGygCsv(text, affiliateMaps.gyg);
  } else if (partner === 'booking') {
    const col = db.collection('affiliation_revenue');
    const bookingAnalysis = analyzeBookingCsv(text);
    const { checkInMonths } = bookingAnalysis;

    const n1MonthsUnique = [
      ...new Set(
        checkInMonths.map((month) => {
          const [year, mo] = month.split('-');
          return `${parseInt(year, 10) - 1}-${mo}`;
        }),
      ),
    ];

    const n1CountByYm: Record<string, number> = {};
    if (n1MonthsUnique.length > 0) {
      const agg = await col
        .aggregate([
          { $match: { partner: 'booking', status: 'Stayed' } },
          { $project: { ym: { $substr: ['$dateStr', 0, 7] } } },
          { $match: { ym: { $in: n1MonthsUnique } } },
          { $group: { _id: '$ym', n: { $sum: 1 } } },
        ])
        .toArray();
      for (const r of agg) {
        if (r._id) n1CountByYm[r._id as string] = r.n as number;
      }
    }

    const n1ByMonth: Record<string, number> = {};
    for (const month of checkInMonths) {
      const [year, mo] = month.split('-');
      const n1Month = `${parseInt(year, 10) - 1}-${mo}`;
      n1ByMonth[month] = n1CountByYm[n1Month] ?? 0;
    }

    result = completeBookingParse(bookingAnalysis, n1ByMonth, affiliateMaps.booking);
  } else if (partner === 'tiqets') {
    result = parseTiqetsCsv(text, affiliateMaps.tiqets);
  } else if (partner === 'discovercars') {
    result = parseDiscoverCarsCsv(text, affiliateMaps.discovercars);
  } else {
    const soProducts = await db.collection('sendowl_products').find({}).toArray();
    const productNameMap: Record<string, string> = {};
    for (const p of soProducts) {
      if (p.productName && p.siteName) productNameMap[p.productName] = p.siteName;
    }
    result = parseSendowlCsv(text, productNameMap);
  }

  if (result.records.length === 0) {
    return {
      ok: true,
      body: {
        partner,
        inserted: 0,
        skipped: result.skipped,
        errors: result.errors,
        unmappedProducts: result.unmappedProducts ?? [],
        detectedColumns: result.detectedColumns ?? headers,
        message: 'Aucun enregistrement valide trouvé dans le fichier.',
      },
    };
  }

  const col = db.collection('affiliation_revenue');
  let inserted = 0;
  let updated = 0;
  let duplicates = 0;

  if (partner === 'booking') {
    const ops = result.records.map((record) => ({
      replaceOne: {
        filter: { orderId: record.orderId, partner: record.partner },
        replacement: record,
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      const CHUNK = 800;
      let upserted = 0;
      let modified = 0;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const slice = ops.slice(i, i + CHUNK);
        const bulkRes = await col.bulkWrite(slice, { ordered: false });
        upserted += bulkRes.upsertedCount;
        modified += bulkRes.modifiedCount;
      }
      inserted = upserted;
      updated = modified;
      duplicates = result.records.length - inserted - updated;
    }
  } else {
    const existingIds = new Set(
      (await col
        .find(
          { partner, orderId: { $in: result.records.map((r) => r.orderId) } },
          { projection: { orderId: 1 } },
        )
        .toArray()).map((d) => d.orderId as string),
    );

    const newRecords = result.records.filter((r) => !existingIds.has(r.orderId));
    duplicates = result.records.length - newRecords.length;

    if (newRecords.length > 0) {
      await col.insertMany(newRecords, { ordered: false });
      inserted = newRecords.length;
    }
  }

  const totalCommission = result.records.reduce((sum, r) => sum + r.commissionActual, 0);
  const totalNonCancelled = result.records
    .filter((r) => !r.status?.toLowerCase().includes('cancel'))
    .reduce((sum, r) => sum + r.commissionActual, 0);

  const cancelled = result.records.filter((r) => r.status?.toLowerCase().includes('cancel')).length;

  const bookingDateFormat = (result as { bookingDateFormat?: string }).bookingDateFormat;

  let recalculate: { recordsUpdated: number; monthSummary: unknown[] } | undefined;
  if (partner === 'booking') {
    const rc = await recalculateBookingCommissions(db);
    recalculate = { recordsUpdated: rc.recordsUpdated, monthSummary: rc.monthSummary };
  }

  return {
    ok: true,
    body: {
      partner,
      inserted,
      updated,
      duplicates,
      skipped: result.skipped,
      cancelled,
      errors: result.errors,
      unmappedProducts: result.unmappedProducts ?? [],
      totalCommission: Math.round(totalNonCancelled * 100) / 100,
      totalCommissionWithCancelled: Math.round(totalCommission * 100) / 100,
      detectedColumns: result.detectedColumns ?? headers,
      ...(bookingDateFormat ? { bookingDateFormat } : {}),
      ...(recalculate ? { recalculate } : {}),
      message: `${inserted} enregistrements importés, ${updated} mis à jour (${duplicates} doublons ignorés, ${cancelled} annulés)${recalculate ? ` — ${recalculate.recordsUpdated} tiers recalculés` : ''}`,
    },
  };
}
