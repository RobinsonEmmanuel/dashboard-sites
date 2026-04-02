'use client';

import { useMemo } from 'react';
import {
  getAvailableYears,
  getCurrentYearWeeks,
  getRecentMonths,
} from '@/lib/period-utils';

export type PeriodType = 'week' | 'month' | 'year' | 'custom';

export interface PeriodState {
  type: PeriodType;
  value: string; // ex: '2026-W10', '2026-03', '2026'
  customStart: string; // YYYY-MM-DD
  customEnd: string; // YYYY-MM-DD
}

export function getInitialPeriod(): PeriodState {
  const now = new Date();
  return {
    type: 'month',
    value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    customStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    customEnd: now.toISOString().slice(0, 10),
  };
}

export function buildPeriodParams(p: PeriodState): URLSearchParams {
  const qs = new URLSearchParams({ periodType: p.type });
  if (p.type !== 'custom') qs.set('periodValue', p.value);
  else { qs.set('start', p.customStart); qs.set('end', p.customEnd); }
  return qs;
}

const PERIOD_TYPES: { id: PeriodType; label: string }[] = [
  { id: 'week', label: 'Semaine' },
  { id: 'month', label: 'Mois' },
  { id: 'year', label: 'Année' },
  { id: 'custom', label: 'Personnalisée' },
];

function getDefaultPeriodValue(type: PeriodType): string {
  const now = new Date();
  if (type === 'week') {
    const weeks = getCurrentYearWeeks();
    return weeks[0]?.value ?? '';
  }
  if (type === 'month') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (type === 'year') {
    return String(now.getFullYear());
  }
  return '';
}

export default function RevenuePeriodSelector({
  period,
  onChange,
}: {
  period: PeriodState;
  onChange: (p: PeriodState) => void;
}) {
  const weeks = useMemo(() => getCurrentYearWeeks(), []);
  const months = useMemo(() => getRecentMonths(36), []);
  const years = useMemo(() => getAvailableYears(), []);

  const setType = (type: PeriodType) => {
    onChange({ ...period, type, value: getDefaultPeriodValue(type) });
  };
  const setValue = (value: string) => onChange({ ...period, value });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        {PERIOD_TYPES.map((pt) => (
          <button
            key={pt.id}
            onClick={() => setType(pt.id)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              period.type === pt.id
                ? 'bg-[#191E55] text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {pt.label}
          </button>
        ))}
      </div>

      {period.type === 'week' && (
        <select
          value={period.value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
        >
          {weeks.map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
      )}

      {period.type === 'month' && (
        <select
          value={period.value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      )}

      {period.type === 'year' && (
        <select
          value={period.value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
        >
          {years.map((y) => (
            <option key={y.value} value={y.value}>{y.label}</option>
          ))}
        </select>
      )}

      {period.type === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={period.customStart}
            onChange={(e) => onChange({ ...period, customStart: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={period.customEnd}
            onChange={(e) => onChange({ ...period, customEnd: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
          />
        </div>
      )}
      </div>
    </div>
  );
}

