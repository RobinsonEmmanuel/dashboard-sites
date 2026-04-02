'use client';

import { useState } from 'react';
import type { PeriodPreset, PresetRange } from '@/lib/period-utils';
import { resolvePreset } from '@/lib/period-utils';

interface Props {
  value: PeriodPreset;
  customStart?: string;
  customEnd?: string;
  onChange: (preset: PeriodPreset, range: PresetRange, customStart?: string, customEnd?: string) => void;
}

const PRESETS: { label: string; value: PeriodPreset }[] = [
  { label: 'Sem. en cours', value: 'current-week' },
  { label: 'Sem. -1',       value: 'last-week' },
  { label: 'Mois en cours', value: 'current-month' },
  { label: 'Mois -1',       value: 'last-month' },
  { label: 'Année en cours', value: 'current-year' },
  { label: 'Année -1',      value: 'last-year' },
  { label: 'Personnalisée', value: 'custom' },
];

export default function PeriodSelector({ value, customStart, customEnd, onChange }: Props) {
  const [localStart, setLocalStart] = useState(customStart ?? '');
  const [localEnd,   setLocalEnd]   = useState(customEnd   ?? '');

  const select = (preset: PeriodPreset) => {
    if (preset !== 'custom') {
      onChange(preset, resolvePreset(preset));
    } else {
      onChange('custom', resolvePreset('custom', localStart || undefined, localEnd || undefined), localStart, localEnd);
    }
  };

  const applyCustom = () => {
    if (localStart && localEnd && localStart <= localEnd) {
      onChange('custom', resolvePreset('custom', localStart, localEnd), localStart, localEnd);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => select(p.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
              value === p.value
                ? 'bg-[#191E55] text-white border-[#191E55]'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {value === 'custom' && (
        <div className="flex items-center gap-2 mt-1">
          <input
            type="date"
            value={localStart}
            onChange={(e) => setLocalStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#191E55] outline-none"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={localEnd}
            min={localStart}
            onChange={(e) => setLocalEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#191E55] outline-none"
          />
          <button
            onClick={applyCustom}
            disabled={!localStart || !localEnd || localStart > localEnd}
            className="px-3 py-1.5 text-sm font-medium text-white bg-[#f57503] rounded-lg hover:bg-[#e06a02] transition-colors disabled:opacity-40"
          >
            Appliquer
          </button>
        </div>
      )}
    </div>
  );
}
