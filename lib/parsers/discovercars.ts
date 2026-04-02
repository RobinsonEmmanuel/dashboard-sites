import type { AffiliationRevenue } from '@/lib/models/revenue';
import { DISCOVERCARS_CHANNEL_MAP } from '@/lib/mappings/discovercars-channels';
import { parseCsv, normalizeDate, parseAmount } from './csv-utils';

export interface ParseResult {
  records: Omit<AffiliationRevenue, '_id'>[];
  skipped: number;
  errors: string[];
}

/**
 * DiscoverCars CSV parser
 * Colonnes clés : Created, Your Commission, Channel name
 */
export function parseDiscoverCarsCsv(text: string, siteMap?: Record<string, string>): ParseResult {
  const rows = parseCsv(text);
  const records: Omit<AffiliationRevenue, '_id'>[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const keys = Object.keys(row);
    const get = (name: string) => {
      const key = keys.find((k) => k.toLowerCase().includes(name.toLowerCase()));
      return key ? row[key] : '';
    };

    const getExact = (target: string) => {
      const key = keys.find((k) => k.toLowerCase().trim() === target.toLowerCase());
      return key ? row[key] : '';
    };

    const status = get('status');
    // Exclure les annulations si le statut est présent
    if (status && (status.toLowerCase().includes('cancel') || status.toLowerCase().includes('refund'))) {
      skipped++;
      continue;
    }

    const dateRaw = get('created') || get('booking date') || get('date');
    const dateStr = normalizeDate(dateRaw);
    if (!dateStr) {
      if (dateRaw) errors.push(`Date invalide : ${dateRaw}`);
      continue;
    }

    const commissionRaw = get('your commission') || get('commission');
    const commission = parseAmount(commissionRaw);
    if (commission <= 0) {
      skipped++;
      continue;
    }

    const channel = (get('channel name') || get('channel') || '').trim();
    const siteName = (siteMap ?? DISCOVERCARS_CHANNEL_MAP)[channel] ?? undefined;

    const orderId = get('booking id') || get('order id') || get('id') || `dc-${dateStr}-${Math.random().toString(36).slice(2, 8)}`;

    const reservationCity = (getExact('City') || get('city') || '').trim() || undefined;
    const reservationCountry = (getExact('Country') || get('country') || '').trim() || undefined;

    records.push({
      partner: 'discovercars',
      date: new Date(dateStr),
      dateStr,
      orderId,
      affiliateId: channel || undefined,
      productName: get('car model') || get('product') || undefined,
      commissionActual: commission,
      siteName,
      reservationCity,
      reservationCountry,
      status: status || undefined,
      importedAt: new Date(),
    });
  }

  return { records, skipped, errors };
}

/** Détection : le CSV DiscoverCars contient "Channel name" et "Your Commission" */
export function isDiscoverCarsCsv(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase());
  return h.some((x) => x.includes('channel')) && h.some((x) => x.includes('commission'));
}
