import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { parseGygCsv, isGygCsv } from '@/lib/parsers/gyg';
import { parseBookingCsv, isBookingCsv } from '@/lib/parsers/booking';
import { parseTiqetsCsv, isTiqetsCsv } from '@/lib/parsers/tiqets';
import { parseDiscoverCarsCsv, isDiscoverCarsCsv } from '@/lib/parsers/discovercars';
import { parseSendowlCsv, isSendowlCsv } from '@/lib/parsers/sendowl';
import { getCsvHeaders } from '@/lib/parsers/csv-utils';
import { recalculateBookingCommissions } from '@/lib/booking-recalculate';
import { buildAffiliateMaps } from '@/lib/affiliate-maps';
import type { AffiliationPartner } from '@/lib/models/revenue';

function detectPartner(headers: string[]): AffiliationPartner | null {
  if (isGygCsv(headers)) return 'getyourguide';
  if (isTiqetsCsv(headers)) return 'tiqets';
  if (isSendowlCsv(headers)) return 'sendowl';
  if (isDiscoverCarsCsv(headers)) return 'discovercars';
  if (isBookingCsv(headers)) return 'booking';
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const partnerOverride = formData.get('partner') as AffiliationPartner | null;

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni' }, { status: 400 });
    }

    const text = await file.text();
    if (!text.trim()) {
      return NextResponse.json({ error: 'Le fichier est vide' }, { status: 400 });
    }

    // Détecter le partenaire via les headers du CSV
    const headers = getCsvHeaders(text);
    const partner = partnerOverride || detectPartner(headers);

    if (!partner) {
      return NextResponse.json({
        error: 'Partenaire non reconnu. Veuillez sélectionner le partenaire manuellement.',
        detectedHeaders: headers,
      }, { status: 422 });
    }

    // Parser selon le partenaire
    let result: {
      records: Omit<import('@/lib/models/revenue').AffiliationRevenue, '_id'>[];
      skipped: number;
      errors: string[];
      unmappedProducts?: string[];
      checkInMonths?: string[];
      detectedColumns?: string[];
    };

    // Connexion DB commune pour booking (N-1), sendowl (mapping produits) et affiliate maps
    const db = await getDatabase();

    // Charger les maps affilié→site depuis la collection `sites` (dynamique)
    const affiliateMaps = await buildAffiliateMaps(db);

    if (partner === 'getyourguide') {
      result = parseGygCsv(text, affiliateMaps.gyg);
    } else if (partner === 'booking') {
      const col = db.collection('affiliation_revenue');

      // Pré-parser pour obtenir les mois de check-in distincts
      const { checkInMonths } = parseBookingCsv(text, {}, affiliateMaps.booking);

      // Requêter MongoDB pour le volume N-1 par mois de check-in
      const n1ByMonth: Record<string, number> = {};
      for (const month of checkInMonths) {
        const [year, mo] = month.split('-');
        const prevYear = String(parseInt(year) - 1);
        const n1Month = `${prevYear}-${mo}`;
        const count = await col.countDocuments({
          partner: 'booking',
          dateStr: { $regex: `^${n1Month}` },
          status: 'Stayed',
        });
        n1ByMonth[month] = count;
      }

      result = parseBookingCsv(text, n1ByMonth, affiliateMaps.booking);
    } else if (partner === 'tiqets') {
      result = parseTiqetsCsv(text, affiliateMaps.tiqets);
    } else if (partner === 'discovercars') {
      result = parseDiscoverCarsCsv(text, affiliateMaps.discovercars);
    } else {
      // Charger le mapping productName → siteName depuis MongoDB
      const soProducts = await db.collection('sendowl_products').find({}).toArray();
      const productNameMap: Record<string, string> = {};
      for (const p of soProducts) {
        if (p.productName && p.siteName) productNameMap[p.productName] = p.siteName;
      }
      result = parseSendowlCsv(text, productNameMap);
    }

    if (result.records.length === 0) {
      return NextResponse.json({
        partner,
        inserted: 0,
        skipped: result.skipped,
        errors: result.errors,
        unmappedProducts: result.unmappedProducts ?? [],
        detectedColumns: result.detectedColumns ?? headers,
        message: 'Aucun enregistrement valide trouvé dans le fichier.',
      });
    }

    // Upsert dans MongoDB — pour Booking, on remplace les enregistrements existants
    // (permet de corriger les données mal importées sans vider la collection)
    const col = db.collection('affiliation_revenue');
    let inserted = 0;
    let updated = 0;
    let duplicates = 0;

    for (const record of result.records) {
      if (partner === 'booking') {
        // replaceOne avec upsert : corrige les dates si le fichier est ré-importé
        const res = await col.replaceOne(
          { orderId: record.orderId, partner: record.partner },
          record,
          { upsert: true },
        );
        if (res.upsertedCount > 0) inserted++;
        else if (res.modifiedCount > 0) updated++;
        else duplicates++;
      } else {
        const existing = await col.findOne({ orderId: record.orderId, partner: record.partner });
        if (existing) {
          duplicates++;
          continue;
        }
        await col.insertOne(record);
        inserted++;
      }
    }

    const totalCommission = result.records.reduce((sum, r) => sum + r.commissionActual, 0);
    // Exclure les annulés du total affiché
    const totalNonCancelled = result.records
      .filter((r) => !r.status?.toLowerCase().includes('cancel'))
      .reduce((sum, r) => sum + r.commissionActual, 0);

    const cancelled = result.records.filter((r) => r.status?.toLowerCase().includes('cancel')).length;

    const bookingDateFormat = (result as { bookingDateFormat?: string }).bookingDateFormat;

    // Recalcul automatique des tiers Booking après chaque import
    let recalculate: { recordsUpdated: number; monthSummary: unknown[] } | undefined;
    if (partner === 'booking') {
      const rc = await recalculateBookingCommissions(db);
      recalculate = { recordsUpdated: rc.recordsUpdated, monthSummary: rc.monthSummary };
    }

    return NextResponse.json({
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
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Détection automatique du partenaire sans import */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const preview = searchParams.get('headers');
  if (!preview) return NextResponse.json({ error: 'Paramètre headers manquant' }, { status: 400 });

  const headers = preview.split(',').map((h) => h.trim());
  const partner = detectPartner(headers);
  return NextResponse.json({ partner });
}
