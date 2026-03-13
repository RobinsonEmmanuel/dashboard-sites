import type { AffiliationRevenue } from '@/lib/models/revenue';
import { parseCsv, normalizeDate, parseAmount } from './csv-utils';

export interface ParseResult {
  records: Omit<AffiliationRevenue, '_id'>[];
  skipped: number;
  errors: string[];
  /** Noms de produits non trouvés dans le mapping — utile pour mettre à jour la table */
  unmappedProducts: string[];
}

/**
 * SendOwl CSV parser — format "Orders" (export complet)
 *
 * Colonnes clés :
 *   SendOwl Order ID  → orderId
 *   Item Name         → productName + lookup dans productNameMap
 *   Amount            → commissionActual (revenu brut hors frais Stripe/PayPal)
 *   Order date/time   → dateStr
 *   State             → "Complete" = OK ; "Refunded" = commission 0
 *   Refunded          → "TRUE" = rembours
 *
 * @param text           Contenu CSV
 * @param productNameMap productName (normalisé) → siteName
 */
export function parseSendowlCsv(
  text: string,
  productNameMap: Record<string, string> = {},
): ParseResult {
  const rows = parseCsv(text);
  const records: Omit<AffiliationRevenue, '_id'>[] = [];
  let skipped = 0;
  const errors: string[] = [];
  const unmappedProducts: string[] = [];

  if (rows.length === 0) return { records, skipped, errors, unmappedProducts };

  for (const row of rows) {
    const keys = Object.keys(row);
    const get = (name: string) => {
      const key = keys.find((k) => k.toLowerCase().replace(/[\s_\/]/g, '').includes(name.toLowerCase().replace(/[\s_\/]/g, '')));
      return key ? row[key] : '';
    };

    // Date
    const dateRaw = get('orderdate') || get('completedat') || get('date');
    const dateStr = normalizeDate(dateRaw);
    if (!dateStr) {
      if (dateRaw) errors.push(`Date invalide : ${dateRaw}`);
      continue;
    }

    // Statut
    const state     = get('state') || get('status') || '';
    const refunded  = get('refunded').toLowerCase() === 'true';
    const isCancelled = refunded || state.toLowerCase() === 'refunded';

    // Montant
    const amountRaw = get('amount') || get('paymentgross') || '';
    const amount    = parseAmount(amountRaw);

    if (!isCancelled && amount <= 0) {
      skipped++;
      continue;
    }

    // Nom du produit
    const rawItemName = get('itemname') || get('productname') || '';

    // Normaliser le nom : supprimer le suffixe "(xN)" pour trouver le mapping
    // Ex: "Der Roadtrip ... (eBook) (x2)" → "Der Roadtrip ... (eBook) (x1)"
    const normalizedName = rawItemName.replace(/\(x\d+\)$/, '(x1)').trim();

    const siteName = productNameMap[rawItemName] ?? productNameMap[normalizedName] ?? undefined;

    if (!siteName && rawItemName) {
      if (!unmappedProducts.includes(normalizedName)) {
        unmappedProducts.push(normalizedName);
      }
    }

    const orderId = get('sendowlorderid') || get('orderid') || `so-${dateStr}-${Math.random().toString(36).slice(2, 8)}`;

    records.push({
      partner: 'sendowl',
      date: new Date(dateStr),
      dateStr,
      orderId,
      productName: rawItemName || undefined,
      commissionActual: isCancelled ? 0 : amount,
      siteName,
      status: isCancelled ? 'Refunded' : state || undefined,
      importedAt: new Date(),
    });
  }

  return { records, skipped, errors, unmappedProducts };
}

/** Détection : le CSV SendOwl contient "SendOwl Order ID" ou "Item Name" + "Order date/time" */
export function isSendowlCsv(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase().replace(/[\s_\/]/g, ''));
  return h.some((x) => x.includes('sendowlorderid')) ||
    (h.some((x) => x.includes('itemname')) && h.some((x) => x.includes('orderdatetime')));
}
