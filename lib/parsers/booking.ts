import type { AffiliationRevenue } from '@/lib/models/revenue';
import { BOOKING_AFFILIATE_MAP } from '@/lib/mappings/booking-affiliates';
import { parseCsv, normalizeDate, parseAmount } from './csv-utils';

/**
 * Détecte le format de date utilisé dans les colonnes "Booking date" du CSV.
 * Booking.com utilise parfois DD/MM/YYYY (export EU) et parfois MM/DD/YYYY (export US).
 *
 * Règle : si AU MOINS UNE date a son 2e composant > 12, c'est forcément MM/DD/YYYY
 * (le jour ne peut pas être en 2e position si > 12).
 */
function detectBookingDateFormat(rows: Record<string, string>[]): 'DD/MM/YYYY' | 'MM/DD/YYYY' {
  for (const row of rows) {
    const key = Object.keys(row).find((k) => k.toLowerCase().includes('booking date'));
    const raw = key ? row[key] : '';
    if (!raw) continue;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/);
    if (m) {
      const second = parseInt(m[2], 10);
      if (second > 12) return 'MM/DD/YYYY';
    }
  }
  return 'DD/MM/YYYY';
}

/**
 * Normalise une date en tenant compte du format détecté.
 * Utilisé pour TOUTES les dates Booking (booking date ET check-in date)
 * car elles partagent le même format dans un même export.
 */
function parseBookingDate(raw: string, format: 'DD/MM/YYYY' | 'MM/DD/YYYY'): string {
  if (!raw) return '';
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, a, b, year] = m;
    // DD/MM → YYYY-MM-DD ; MM/DD → YYYY-MM-DD (inverser a et b)
    const day   = format === 'DD/MM/YYYY' ? a : b;
    const month = format === 'DD/MM/YYYY' ? b : a;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return normalizeDate(raw);
}

export interface ParseResult {
  records: Omit<AffiliationRevenue, '_id'>[];
  skipped: number;
  errors: string[];
  checkInMonths: string[];
  detectedColumns: string[];
  bookingDateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY';
}

/**
 * Tiers de commission Booking selon le volume mensuel de stayed reservations
 */
export function getBookingTier(monthlyStayed: number): number {
  if (monthlyStayed > 500) return 0.40;
  if (monthlyStayed > 150) return 0.35;
  if (monthlyStayed > 50)  return 0.30;
  return 0.25;
}

/**
 * Booking.com CSV parser
 *
 * Logique de calcul des commissions :
 *   SÉJOURS TERMINÉS (status = "Stayed") :
 *     - "Your commission" = montant FINAL confirmé par Booking.com → commissionActual direct
 *     - "Commission %" = pourcentage réel appliqué → permet de back-calculer commissionMin
 *
 *   RÉSERVATIONS FUTURES (status = "Booked") :
 *     - "Your commission" = fourchette "X.XX - Y.YY" (valeur 25% → valeur 40%)
 *     - Tier estimé via le count N-1 stayed MongoDB pour ce mois de check-in
 *
 *   ANNULÉS : commission = 0, enregistrés pour statistiques
 *
 * dateStr = date de CHECK-IN (aligne le reporting avec la logique de paiement Booking)
 *
 * IMPORTANT : les dates de check-in utilisent le MÊME format (DD/MM ou MM/DD)
 * que les booking dates → on applique parseBookingDate aux deux colonnes.
 */
export function parseBookingCsv(
  text: string,
  n1ByMonth: Record<string, number> = {},
  siteMap?: Record<string, string>,
): ParseResult {
  const rows = parseCsv(text);
  const records: Omit<AffiliationRevenue, '_id'>[] = [];
  let skipped = 0;
  const errors: string[] = [];

  if (rows.length === 0) {
    return { records, skipped, errors, checkInMonths: [], detectedColumns: [], bookingDateFormat: 'DD/MM/YYYY' as const };
  }

  const detectedColumns = Object.keys(rows[0]);
  const makeGet = (row: Record<string, string>) => (name: string) => {
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(name.toLowerCase()));
    return key ? row[key] : '';
  };

  // Détecter le format de date UNE FOIS pour tout le fichier
  // (même format pour booking date ET check-in date dans le même export)
  const bookingDateFormat = detectBookingDateFormat(rows);

  // ── 1ère passe : compter les "Stayed" par mois de check-in ───────────────────
  const stayedCounts: Record<string, number> = {};
  const checkInMonthsSet = new Set<string>();

  for (const row of rows) {
    const get = makeGet(row);
    const checkInRaw = get('check-in date') || get('check-in') || get('check in');
    // FIX : utiliser parseBookingDate (même format que booking date), pas normalizeDate
    const checkInStr = parseBookingDate(checkInRaw, bookingDateFormat);
    if (!checkInStr) continue;

    const month = checkInStr.slice(0, 7);
    checkInMonthsSet.add(month);

    const status = get('status').toLowerCase();
    if (status === 'stayed') {
      stayedCounts[month] = (stayedCounts[month] ?? 0) + 1;
    }
  }

  const checkInMonths = [...checkInMonthsSet].sort();

  // ── 2ème passe : générer les enregistrements ─────────────────────────────────
  for (const row of rows) {
    const get = makeGet(row);

    const bookingNumber = get('booking number') || get('booking id') || get('order id') || get('reservation id');

    const bookingDateRaw = get('booking date') || get('date');
    const bookingDateStr = parseBookingDate(bookingDateRaw, bookingDateFormat);

    const checkInRaw = get('check-in date') || get('check-in') || get('check in');
    // FIX : même format pour check-in que pour booking date
    const checkInStr = parseBookingDate(checkInRaw, bookingDateFormat);

    const checkOutRaw = get('check-out date') || get('check-out') || get('check out');
    const checkOutStr = parseBookingDate(checkOutRaw, bookingDateFormat);

    // dateStr = check-in date (aligne avec le reporting mensuel Booking.com / tiers)
    const dateStr = checkInStr || bookingDateStr;

    if (!dateStr) {
      if (bookingDateRaw || checkInRaw) errors.push(`Date invalide : ${bookingDateRaw || checkInRaw}`);
      continue;
    }

    const tierMonth   = dateStr.slice(0, 7);
    const status      = get('status') || '';
    const statusLower = status.toLowerCase();
    const isCancelled = statusLower.includes('cancel');
    const isStayed    = statusLower === 'stayed';
    const isBooked    = statusLower === 'booked';

    const commissionRaw    = get('your commission');
    const commissionPctRaw = get('commission %') || get('commission%') || get('commission pct');

    if (!commissionRaw && !isCancelled) {
      skipped++;
      continue;
    }

    let commissionActual = 0;
    let commissionMin: number | undefined;
    let commissionN1: number | undefined;

    if (!isCancelled && commissionRaw) {
      if (isStayed) {
        // ─── Séjour terminé : Booking.com fournit la commission FINALE exacte ───
        // "Your commission" = montant réel (ex: 13.01)
        // "Commission %" = pourcentage réel (ex: 40)
        commissionActual = parseAmount(commissionRaw);
        if (commissionActual <= 0) { skipped++; continue; }

        // Back-calculer commissionMin (base à 25%) depuis la commission réelle et le tier %
        const actualPct = parseAmount(commissionPctRaw) / 100;
        const tierPct   = actualPct > 0 ? actualPct : getBookingTier(stayedCounts[tierMonth] ?? 0);
        commissionMin   = tierPct > 0 ? Math.round(commissionActual * (0.25 / tierPct) * 100) / 100 : undefined;

      } else {
        // ─── Réservation future (Booked) ou statut inconnu : "Your commission" = fourchette ─
        const rangeMatch = commissionRaw.match(/^([\d.,]+)\s*-\s*([\d.,]+)/);
        const minValue   = rangeMatch ? parseAmount(rangeMatch[1]) : parseAmount(commissionRaw);

        if (minValue <= 0) { skipped++; continue; }

        commissionMin = minValue;
        const base = minValue / 0.25;

        // Estimation du tier pour les "Booked" via N-1 stayed count
        const tierCurrent = isBooked
          ? getBookingTier(n1ByMonth[tierMonth] ?? 0)
          : 0.25; // statut inconnu → tier prudent

        commissionActual = Math.round(base * tierCurrent * 100) / 100;
        const tierN1     = getBookingTier(n1ByMonth[tierMonth] ?? 0);
        commissionN1     = Math.round(base * tierN1 * 100) / 100;
      }
    }

    const affiliateId = (get('affiliate id') || get('affiliate_id')).trim();
    const siteName    = (siteMap ?? BOOKING_AFFILIATE_MAP)[affiliateId] ?? undefined;
    const orderId     = bookingNumber || `bk-${dateStr}-${Math.random().toString(36).slice(2, 8)}`;

    records.push({
      partner: 'booking',
      date: new Date(dateStr),
      dateStr,
      bookingDateStr: bookingDateStr || undefined,
      checkOutDateStr: checkOutStr || undefined,
      orderId,
      affiliateId: affiliateId || undefined,
      productName: get('property name') || get('hotel name') || undefined,
      commissionActual,
      commissionMin: commissionMin !== undefined && commissionMin > 0 ? commissionMin : undefined,
      commissionN1,
      siteName,
      status: status || undefined,
      importedAt: new Date(),
    });
  }

  return { records, skipped, errors, checkInMonths, detectedColumns, bookingDateFormat };
}

/** Détection : le CSV Booking contient "Your commission" et "Affiliate ID" */
export function isBookingCsv(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase());
  return h.some((x) => x.includes('affiliate')) && h.some((x) => x.includes('commission'));
}
