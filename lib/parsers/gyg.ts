import type { AffiliationRevenue } from '@/lib/models/revenue';
import { GYG_CAMPAIGN_MAP } from '@/lib/mappings/gyg-campaigns';
import { parseCsv, normalizeDate, parseAmount } from './csv-utils';

export interface ParseResult {
  records: Omit<AffiliationRevenue, '_id'>[];
  skipped: number;
  errors: string[];
}

/**
 * GetYourGuide CSV parser
 * Colonnes clés : Booking date, Potential income, Campaign, Status
 * Filtre : exclure les lignes avec Status = "Canceled"
 */
export function parseGygCsv(text: string, siteMap?: Record<string, string>): ParseResult {
  const rows = parseCsv(text);
  const records: Omit<AffiliationRevenue, '_id'>[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    // Trouver les colonnes (case-insensitive)
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
    if (status.toLowerCase() === 'canceled' || status.toLowerCase() === 'cancelled') {
      skipped++;
      continue;
    }

    const dateRaw = get('booking date');
    const dateStr = normalizeDate(dateRaw);
    if (!dateStr) {
      if (dateRaw) errors.push(`Date invalide : ${dateRaw}`);
      // Ligne vide ou ligne de total → skip silencieux
      continue;
    }

    const campaign = (get('campaign') || '').trim();
    const siteName = (siteMap ?? GYG_CAMPAIGN_MAP)[campaign] ?? undefined;

    const income = parseAmount(get('potential income'));
    if (income <= 0) {
      skipped++;
      continue;
    }

    const orderId = get('booking id') || get('order id') || `gyg-${dateStr}-${Math.random().toString(36).slice(2, 8)}`;

    const reservationCity = (getExact('City') || get('city') || '').trim() || undefined;
    const reservationCountry = (getExact('Country') || get('country') || get('booking country') || '').trim() || undefined;

    records.push({
      partner: 'getyourguide',
      date: new Date(dateStr),
      dateStr,
      orderId,
      affiliateId: campaign || undefined,
      productName: get('activity') || get('product') || undefined,
      commissionActual: income,
      siteName,
      reservationCity,
      reservationCountry,
      status,
      importedAt: new Date(),
    });
  }

  return { records, skipped, errors };
}

/** Détection : le CSV GYG contient les colonnes "Booking date" et "Potential income" */
export function isGygCsv(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase());
  return h.some((x) => x.includes('potential income')) || h.some((x) => x.includes('campaign') && x.includes('booking date'));
}
