import type { AffiliationRevenue } from '@/lib/models/revenue';
import { TIQETS_CAMPAIGN_MAP } from '@/lib/mappings/tiqets-campaigns';
import { parseCsv, normalizeDate, parseAmount } from './csv-utils';

export interface ParseResult {
  records: Omit<AffiliationRevenue, '_id'>[];
  skipped: number;
  errors: string[];
}

/**
 * Tiqets CSV parser
 * Colonnes clés : Ordered At (date en anglais long), Commission (ex: "€ 1.50"), Campaign
 * Filtre : uniquement les lignes avec Status = "fulfilled"
 */
export function parseTiqetsCsv(text: string, siteMap?: Record<string, string>): ParseResult {
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

    const status = get('status');
    if (status && status.toLowerCase() !== 'fulfilled') {
      skipped++;
      continue;
    }

    const dateRaw = get('ordered at') || get('order date') || get('date');
    const dateStr = normalizeDate(dateRaw);
    if (!dateStr) {
      if (dateRaw) errors.push(`Date invalide : ${dateRaw}`);
      continue;
    }

    const commissionRaw = get('commission');
    // Strip "€ " prefix
    const commission = parseAmount(commissionRaw.replace(/€\s*/g, '').replace(/EUR\s*/gi, ''));
    if (commission <= 0) {
      skipped++;
      continue;
    }

    const campaign = (get('campaign') || get('tq_campaign') || '').trim();
    const siteName = (siteMap ?? TIQETS_CAMPAIGN_MAP)[campaign] ?? undefined;

    const orderId = get('order id') || get('booking id') || get('id') || `tq-${dateStr}-${Math.random().toString(36).slice(2, 8)}`;

    records.push({
      partner: 'tiqets',
      date: new Date(dateStr),
      dateStr,
      orderId,
      productName: get('product name') || get('product') || undefined,
      commissionActual: commission,
      siteName,
      status,
      importedAt: new Date(),
    });
  }

  return { records, skipped, errors };
}

/** Détection : le CSV Tiqets contient "Ordered At" ou "tq_campaign" */
export function isTiqetsCsv(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase());
  return h.some((x) => x.includes('ordered at')) || h.some((x) => x.includes('tq_campaign'));
}
