'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon,
  ArrowPathIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SiteRow {
  siteId: string;
  siteName: string;
  shortName: string;
  sessions: number;
  sessionsDelta: number | null;
  outboundClicks: number;
  clicks: number;
  clicksDelta: number | null;
  impressions: number;
  impressionsDelta: number | null;
  ctr: number;
  position: number;
}

type SortKey = keyof SiteRow;
type SortDir = 'asc' | 'desc';

const PERIODS = [
  { label: '7 jours', value: '7d' },
  { label: '30 jours', value: '30d' },
  { label: '90 jours', value: '90d' },
  { label: '12 mois', value: '365d' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

function DeltaBadge({ delta, inverse = false }: { delta: number | null; inverse?: boolean }) {
  if (delta === null) return <span className="text-gray-300 text-xs">—</span>;
  const isGood = inverse ? delta < 0 : delta > 0;
  const isNeutral = Math.abs(delta) < 0.5;
  const cls = isNeutral
    ? 'text-gray-400'
    : isGood
    ? 'text-green-600'
    : 'text-red-500';
  const Icon = isNeutral ? MinusIcon : isGood ? ArrowUpIcon : ArrowDownIcon;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${cls}`}>
      <Icon className="w-3 h-3" />
      {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronUpDownIcon className="w-3.5 h-3.5 text-gray-300 ml-1" />;
  return sortDir === 'asc'
    ? <ChevronUpIcon className="w-3.5 h-3.5 text-[#191E55] ml-1" />
    : <ChevronDownIcon className="w-3.5 h-3.5 text-[#191E55] ml-1" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SitesComparisonPage() {
  const [period, setPeriod] = useState('30d');
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [range, setRange] = useState({ start: '', end: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('sessions');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/sites-comparison?period=${period}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows(data.rows ?? []);
      setRange(data.range ?? { start: '', end: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const exportCsv = () => {
    const headers = ['Site', 'Sessions', 'Δ Sessions', 'Clics GSC', 'Δ Clics', 'Impressions', 'CTR', 'Position'];
    const csvRows = sorted.map((r) => [
      r.siteName,
      r.sessions,
      r.sessionsDelta !== null ? r.sessionsDelta.toFixed(1) + '%' : '—',
      r.clicks,
      r.clicksDelta !== null ? r.clicksDelta.toFixed(1) + '%' : '—',
      r.impressions,
      (r.ctr * 100).toFixed(2) + '%',
      r.position.toFixed(1),
    ]);
    const csv = [headers, ...csvRows].map((row) => row.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comparaison-sites-${period}-${range.start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Th = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-900 transition-colors"
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center">
        {label}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </span>
    </th>
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comparaison des sites</h1>
          {range.start && (
            <p className="text-gray-500 mt-1 text-sm">{range.start} → {range.end}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={!rows.length}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Période */}
      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 w-fit mb-6">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              period === p.value ? 'bg-[#191E55] text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {/* Légende */}
      {rows.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
          <span className="flex items-center gap-1"><ArrowUpIcon className="w-3 h-3 text-green-500" /> Croissance vs N-1</span>
          <span className="flex items-center gap-1"><ArrowDownIcon className="w-3 h-3 text-red-500" /> Décroissance vs N-1</span>
          <span className="text-gray-300">Cliquez sur un en-tête pour trier</span>
        </div>
      )}

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <ArrowPathIcon className="w-6 h-6 text-gray-300 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-gray-400 text-sm">Aucune donnée pour cette période.</p>
            <p className="text-gray-400 text-xs mt-1">Lancez une synchronisation pour alimenter le dashboard.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <Th label="Site" col="siteName" />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Sessions</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Δ vs N-1</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Liens sortants</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Clics GSC</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Δ vs N-1</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Impressions</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">CTR</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sorted.map((row, idx) => {
                  const sessionGrowth = row.sessionsDelta !== null && row.sessionsDelta >= 5;
                  const sessionDecline = row.sessionsDelta !== null && row.sessionsDelta <= -5;
                  return (
                    <tr key={row.siteId} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-4 text-right">{idx + 1}</span>
                          <div>
                            <span className="font-medium text-gray-900">{row.siteName}</span>
                            <span className="text-xs text-gray-400 ml-2">{row.shortName}</span>
                          </div>
                          {sessionGrowth && (
                            <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">↑</span>
                          )}
                          {sessionDecline && (
                            <span className="text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">↓</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-gray-900">{fmtNum(row.sessions)}</td>
                      <td className="px-4 py-3.5"><DeltaBadge delta={row.sessionsDelta} /></td>
                      <td className="px-4 py-3.5 text-gray-600">{fmtNum(row.outboundClicks)}</td>
                      <td className="px-4 py-3.5 font-medium text-gray-900">{fmtNum(row.clicks)}</td>
                      <td className="px-4 py-3.5"><DeltaBadge delta={row.clicksDelta} /></td>
                      <td className="px-4 py-3.5 text-gray-600">{fmtNum(row.impressions)}</td>
                      <td className="px-4 py-3.5 text-gray-600">{(row.ctr * 100).toFixed(2)}%</td>
                      <td className="px-4 py-3.5 text-gray-600">{row.position > 0 ? row.position.toFixed(1) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totaux */}
              <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                <tr>
                  <td className="px-4 py-3 text-xs font-bold text-gray-600 uppercase">Total ({rows.length} sites)</td>
                  <td className="px-4 py-3 font-bold text-gray-900">{fmtNum(rows.reduce((s, r) => s + r.sessions, 0))}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 font-semibold text-gray-700">{fmtNum(rows.reduce((s, r) => s + r.outboundClicks, 0))}</td>
                  <td className="px-4 py-3 font-bold text-gray-900">{fmtNum(rows.reduce((s, r) => s + r.clicks, 0))}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 font-semibold text-gray-700">{fmtNum(rows.reduce((s, r) => s + r.impressions, 0))}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
