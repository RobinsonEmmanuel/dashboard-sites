/**
 * Utilitaires de calcul de périodes pour les API revenue (stats + chart)
 *
 * Formats acceptés :
 *   week:2026-W10          → semaine ISO (lundi–dimanche)
 *   month:2026-03          → mois complet
 *   year:2026              → année complète
 *   custom:2026-01-01:2026-03-09  → plage personnalisée
 */

export type PeriodGranularity = 'day' | 'week' | 'month';

export interface ResolvedPeriod {
  startStr: string;     // YYYY-MM-DD
  endStr: string;       // YYYY-MM-DD
  label: string;        // Libellé lisible
  granularity: PeriodGranularity;
}

// ── ISO week helpers ──────────────────────────────────────────────────────────

/** Retourne le numéro de semaine ISO et l'année ISO d'une date */
export function getISOWeek(date: Date): { week: number; isoYear: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { week, isoYear: d.getUTCFullYear() };
}

/** Retourne les dates de début (lundi) et fin (dimanche) d'une semaine ISO */
export function isoWeekToDates(isoYear: number, week: number): { start: string; end: string } {
  // Le 4 janvier est toujours en semaine 1
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000);
  const weekStart = new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
  const weekEnd   = new Date(weekStart.getTime() + 6 * 86_400_000);
  return {
    start: weekStart.toISOString().slice(0, 10),
    end:   weekEnd.toISOString().slice(0, 10),
  };
}

/** Liste toutes les semaines ISO de l'année en cours jusqu'à la semaine actuelle */
export function getCurrentYearWeeks(): Array<{ label: string; value: string }> {
  const now = new Date();
  const { week: currentWeek, isoYear } = getISOWeek(now);
  const weeks: Array<{ label: string; value: string }> = [];

  for (let w = 1; w <= currentWeek; w++) {
    const { start, end } = isoWeekToDates(isoYear, w);
    const startFmt = start.slice(5).split('-').reverse().join('/');
    const endFmt   = end.slice(5).split('-').reverse().join('/');
    weeks.push({
      label: `S${String(w).padStart(2, '0')} — ${startFmt} au ${endFmt}`,
      value: `${isoYear}-W${String(w).padStart(2, '0')}`,
    });
  }
  return weeks.reverse(); // semaine la plus récente en premier
}

// ── Month helpers ─────────────────────────────────────────────────────────────

const FR_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

/** Liste les N derniers mois (mois courant inclus) */
export function getRecentMonths(count = 36): Array<{ label: string; value: string }> {
  const months: Array<{ label: string; value: string }> = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ label: `${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}`, value });
  }
  return months;
}

/** Liste les années disponibles (depuis 2023 jusqu'à l'année courante) */
export function getAvailableYears(): Array<{ label: string; value: string }> {
  const currentYear = new Date().getFullYear();
  const years: Array<{ label: string; value: string }> = [];
  for (let y = currentYear; y >= 2023; y--) {
    years.push({ label: String(y), value: String(y) });
  }
  return years;
}

// ── Preset period resolver (for Overview & Comparison pages) ─────────────────

export type PeriodPreset =
  | 'current-week' | 'last-week'
  | 'current-month' | 'last-month'
  | 'current-year' | 'last-year'
  | 'custom';

export interface PresetRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD
  label: string;
}

export function resolvePreset(
  preset: PeriodPreset,
  customStart?: string,
  customEnd?: string,
): PresetRange {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const clamp = (s: string) => s > todayStr ? todayStr : s;

  switch (preset) {
    case 'current-week': {
      const { week, isoYear } = getISOWeek(today);
      const { start, end } = isoWeekToDates(isoYear, week);
      return { start, end: clamp(end), label: 'Semaine en cours' };
    }
    case 'last-week': {
      const { week, isoYear } = getISOWeek(today);
      let w = week - 1, y = isoYear;
      if (w === 0) { y--; w = getISOWeek(new Date(y, 11, 28)).week; }
      const { start, end } = isoWeekToDates(y, w);
      return { start, end, label: 'Semaine -1' };
    }
    case 'current-month': {
      const y = today.getFullYear(), m = today.getMonth();
      const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end: clamp(end), label: 'Mois en cours' };
    }
    case 'last-month': {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end, label: 'Mois -1' };
    }
    case 'current-year': {
      const y = today.getFullYear();
      return { start: `${y}-01-01`, end: todayStr, label: String(y) };
    }
    case 'last-year': {
      const y = today.getFullYear() - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
    }
    case 'custom':
      return {
        start: customStart || todayStr,
        end:   clamp(customEnd || todayStr),
        label: customStart && customEnd
          ? `${customStart.split('-').reverse().join('/')} – ${customEnd.split('-').reverse().join('/')}`
          : 'Personnalisée',
      };
  }
}

/** N-1 d'une plage : même période décalée d'un an en arrière */
export function shiftYearBack(start: string, end: string): { n1Start: string; n1End: string } {
  const shift = (d: string, years: number) => {
    const dt = new Date(d + 'T00:00:00Z');
    dt.setUTCFullYear(dt.getUTCFullYear() + years);
    return dt.toISOString().slice(0, 10);
  };
  return { n1Start: shift(start, -1), n1End: shift(end, -1) };
}

// ── Period resolver ───────────────────────────────────────────────────────────

/**
 * Résout un identifiant de période en dates start/end.
 *
 * @param periodType  'week' | 'month' | 'year' | 'custom'
 * @param periodValue Pour week: '2026-W10', month: '2026-03', year: '2026'
 * @param customStart Pour custom: 'YYYY-MM-DD'
 * @param customEnd   Pour custom: 'YYYY-MM-DD'
 */
export function resolvePeriod(
  periodType: string,
  periodValue?: string | null,
  customStart?: string | null,
  customEnd?: string | null,
): ResolvedPeriod {
  const today = new Date().toISOString().slice(0, 10);

  if (periodType === 'week' && periodValue) {
    const m = periodValue.match(/^(\d{4})-W(\d{2})$/);
    if (m) {
      const { start, end } = isoWeekToDates(parseInt(m[1]), parseInt(m[2]));
      const { week } = getISOWeek(new Date(start));
      return {
        startStr: start,
        endStr:   end,
        label:    `Semaine ${week} (${start.slice(5).split('-').reverse().join('/')} – ${end.slice(5).split('-').reverse().join('/')})`,
        granularity: 'day',
      };
    }
  }

  if (periodType === 'month' && periodValue) {
    const m = periodValue.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const year  = parseInt(m[1]);
      const month = parseInt(m[2]) - 1;
      const start = new Date(year, month, 1);
      const end   = new Date(year, month + 1, 0); // dernier jour du mois
      const startStr = start.toISOString().slice(0, 10);
      const endStr   = end.toISOString().slice(0, 10);
      return {
        startStr,
        endStr,
        label:    `${FR_MONTHS[month]} ${year}`,
        granularity: 'day',
      };
    }
  }

  if (periodType === 'year' && periodValue) {
    const year = parseInt(periodValue);
    if (!isNaN(year)) {
      return {
        startStr:    `${year}-01-01`,
        endStr:      `${year}-12-31`,
        label:       String(year),
        granularity: 'month',
      };
    }
  }

  if (periodType === 'custom' && customStart && customEnd) {
    const diffDays = (new Date(customEnd).getTime() - new Date(customStart).getTime()) / 86_400_000;
    return {
      startStr:    customStart,
      endStr:      customEnd > today ? today : customEnd,
      label:       `${customStart.split('-').reverse().join('/')} – ${customEnd.split('-').reverse().join('/')}`,
      granularity: diffDays > 90 ? 'month' : 'day',
    };
  }

  // Fallback : mois courant
  const now = new Date();
  const defaultValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return resolvePeriod('month', defaultValue);
}
