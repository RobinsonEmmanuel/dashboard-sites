/** Utilitaires mois « YYYY-MM » pour le dossier de trajectoire (séries longues). */

export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function monthStart(mois: string): string {
  return `${mois}-01`;
}

export function monthEnd(mois: string): string {
  const [y, m] = mois.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mois}-${String(lastDay).padStart(2, '0')}`;
}

export function addMonths(mois: string, n: number): string {
  const [y, m] = mois.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Série ascendante de `count` mois se terminant à `lastMonth` (inclus). */
export function monthSeries(lastMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(lastMonth, -(count - 1 - i)));
}

/** Décale une date YYYY-MM-DD d'un nombre entier d'années. */
export function shiftYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Dernier mois COMPLET couvert par une source, d'après sa dernière date disponible.
 * Un mois n'est complet que si la donnée va jusqu'à son dernier jour.
 */
export function lastCompleteMonth(lastDate: string | null | undefined): string | null {
  if (!lastDate) return null;
  const m = monthOf(lastDate);
  return lastDate >= monthEnd(m) ? m : addMonths(m, -1);
}

/** FR lisible : « Mars 2026 ». Utilisé pour les libellés de période. */
const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function moisLisible(mois: string): string {
  const [y, m] = mois.split('-').map(Number);
  return `${FR_MONTHS[m - 1]} ${y}`;
}
