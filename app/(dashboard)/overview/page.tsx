'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MinusIcon,
  ArrowPathIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiSnapshot {
  sessions: number;
  outboundClicks: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface StatsData {
  period: string;
  days: number;
  range: { start: string; end: string };
  current: KpiSnapshot;
  n1: KpiSnapshot;
  n2: KpiSnapshot;
}

interface ChartPoint {
  key: string;
  sessions: number;
  sessionsPY: number;
  clicks: number;
  clicksPY: number;
  impressions: number;
  impressionsPY: number;
}

interface ChartData {
  granularity: string;
  points: ChartPoint[];
}

interface Site { _id: string; name: string; shortName: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toString();
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + ' %';
}

function fmtPos(n: number): string {
  return n.toFixed(1);
}

const PERIODS = [
  { label: '7 jours', value: '7d' },
  { label: '30 jours', value: '30d' },
  { label: '90 jours', value: '90d' },
  { label: '12 mois', value: '365d' },
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  format,
  delta,
  deltaLabel,
  color,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  delta: number | null;
  deltaLabel: string;
  color?: string;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  const isPositiveGood = color !== 'inverse'; // position : plus bas = mieux

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900">{format(value)}</p>
      {delta !== null ? (
        <div className={`flex items-center gap-1 mt-2 text-sm font-medium ${
          (isPositive && isPositiveGood) || (isNegative && !isPositiveGood)
            ? 'text-green-600'
            : (isNegative && isPositiveGood) || (isPositive && !isPositiveGood)
            ? 'text-red-500'
            : 'text-gray-400'
        }`}>
          {isPositive ? (
            <ArrowTrendingUpIcon className="w-4 h-4" />
          ) : isNegative ? (
            <ArrowTrendingDownIcon className="w-4 h-4" />
          ) : (
            <MinusIcon className="w-4 h-4" />
          )}
          <span>{delta > 0 ? '+' : ''}{delta.toFixed(1)} % vs {deltaLabel}</span>
        </div>
      ) : (
        <p className="text-xs text-gray-400 mt-2">Pas de données N-1</p>
      )}
    </div>
  );
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function EvolutionChart({
  data,
  title,
  dataKey,
  dataKeyPY,
  formatter,
}: {
  data: ChartPoint[];
  title: string;
  dataKey: keyof ChartPoint;
  dataKeyPY: keyof ChartPoint;
  formatter?: (v: number) => string;
}) {
  if (!data.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
          Pas encore de données
        </div>
      </div>
    );
  }

  const fmt = formatter ?? ((v: number) => fmtNum(v));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="key"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickFormatter={(v) => v.length === 7 ? v.slice(5) : v.slice(5)}
          />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={fmt} />
          <Tooltip
            formatter={(v) => [fmt(v as number), '']}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey={dataKey as string}
            name="N"
            stroke="#f57503"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey={dataKeyPY as string}
            name="N-1"
            stroke="#191E55"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            activeDot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [period, setPeriod] = useState('30d');
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Charger la liste des sites pour le filtre
  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(Array.isArray(d) ? d : []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period });
      if (siteId) params.set('siteId', siteId);

      const [statsRes, chartRes] = await Promise.all([
        fetch(`/api/overview/stats?${params}`),
        fetch(`/api/overview/chart?${params}`),
      ]);

      const [statsData, chartData] = await Promise.all([
        statsRes.json(),
        chartRes.json(),
      ]);

      if (statsData.error) throw new Error(statsData.error);
      setStats(statsData);
      setChart(chartData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [period, siteId]);

  useEffect(() => { load(); }, [load]);

  const cur = stats?.current;
  const n1 = stats?.n1;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vue d'ensemble</h1>
          {stats && (
            <p className="text-gray-500 mt-1 text-sm">
              {stats.range.start} → {stats.range.end} · {stats.days} jours
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3 mb-7">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                period === p.value
                  ? 'bg-[#191E55] text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
          <FunnelIcon className="w-4 h-4 text-gray-400" />
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="text-sm text-gray-700 bg-transparent outline-none"
          >
            <option value="">Tous les sites</option>
            {sites.map((s) => (
              <option key={s._id} value={s._id}>{s.shortName}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
          {error}
        </div>
      )}

      {loading && !stats ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="h-4 bg-gray-100 rounded w-24 mb-3 animate-pulse" />
              <div className="h-8 bg-gray-100 rounded w-32 animate-pulse" />
            </div>
          ))}
        </div>
      ) : cur ? (
        <>
          {/* Section Trafic */}
          <div className="mb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Trafic</p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <KpiCard
                label="Sessions"
                value={cur.sessions}
                format={fmtNum}
                delta={pct(cur.sessions, n1?.sessions ?? 0)}
                deltaLabel="N-1"
              />
              <KpiCard
                label="Clics affiliation (liens sortants)"
                value={cur.outboundClicks}
                format={fmtNum}
                delta={pct(cur.outboundClicks, n1?.outboundClicks ?? 0)}
                deltaLabel="N-1"
              />
            </div>
          </div>

          {/* Section SEO */}
          <div className="mb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">SEO — Google Search Console</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KpiCard
                label="Clics GSC"
                value={cur.clicks}
                format={fmtNum}
                delta={pct(cur.clicks, n1?.clicks ?? 0)}
                deltaLabel="N-1"
              />
              <KpiCard
                label="Impressions"
                value={cur.impressions}
                format={fmtNum}
                delta={pct(cur.impressions, n1?.impressions ?? 0)}
                deltaLabel="N-1"
              />
              <KpiCard
                label="CTR moyen"
                value={cur.ctr}
                format={fmtPct}
                delta={pct(cur.ctr, n1?.ctr ?? 0)}
                deltaLabel="N-1"
              />
              <KpiCard
                label="Position moyenne"
                value={cur.position}
                format={fmtPos}
                delta={pct(cur.position, n1?.position ?? 0)}
                deltaLabel="N-1"
                color="inverse"
              />
            </div>
          </div>

          {/* Graphiques */}
          {chart && chart.points.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <EvolutionChart
                data={chart.points}
                title="Sessions"
                dataKey="sessions"
                dataKeyPY="sessionsPY"
              />
              <EvolutionChart
                data={chart.points}
                title="Clics GSC"
                dataKey="clicks"
                dataKeyPY="clicksPY"
              />
              <EvolutionChart
                data={chart.points}
                title="Impressions GSC"
                dataKey="impressions"
                dataKeyPY="impressionsPY"
              />
            </div>
          )}

          {chart && chart.points.length === 0 && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
              Aucune donnée disponible pour cette période. Lancez une synchronisation depuis la page <strong>Synchronisation</strong> pour alimenter le dashboard.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
