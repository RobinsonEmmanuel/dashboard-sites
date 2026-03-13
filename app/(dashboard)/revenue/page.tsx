'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowUpTrayIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  CurrencyEuroIcon,
  ChartBarIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { AffiliationPartner, RevenueChartPoint } from '@/lib/models/revenue';
import {
  getCurrentYearWeeks,
  getRecentMonths,
  getAvailableYears,
} from '@/lib/period-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type PeriodType = 'week' | 'month' | 'year' | 'custom';

interface PeriodState {
  type: PeriodType;
  value: string;       // ex: '2026-W10', '2026-03', '2026'
  customStart: string;
  customEnd: string;
}

interface PartnerRow {
  partner: string;
  revenue: number;
  revenueN1: number;
  evolution: number | null;
  bookingsTotal: number;
  cancelledCount: number;
  cancelRate: number | null;
  cancelRateN1: number | null;
}

interface PromisesData {
  byPartnerTable: PartnerRow[];
  totalRevenue: number;
  totalCancelled: number;
  startStr: string;
  endStr: string;
}

interface MonthlyRevenueRow {
  month: string;
  monthLabel: string;
  revenue: number;
  bookings: number;
  stayed: number;
  tier: string;
  tierPct: number;
}

interface Stats {
  totalRevenue: number;
  totalSessions: number;
  cancelledCount?: number;
  rpm: number | null;
  label: string;
  byPartner: Record<AffiliationPartner, number>;
  byPartnerTable: PartnerRow[];
  bySite: Array<{ siteName: string; revenue: number; sessions: number; rpm: number | null }>;
}

interface ImportResult {
  partner: AffiliationPartner;
  inserted: number;
  duplicates: number;
  skipped: number;
  cancelled?: number;
  errors: string[];
  totalCommission: number;
  totalCommissionWithCancelled?: number;
  detectedColumns?: string[];
  message: string;
}

interface Site { _id: string; shortName: string; name: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const PARTNERS: { id: AffiliationPartner; label: string; color: string }[] = [
  { id: 'getyourguide', label: 'GetYourGuide', color: '#FF5533' },
  { id: 'booking',      label: 'Booking.com',  color: '#003580' },
  { id: 'tiqets',       label: 'Tiqets',        color: '#ff6b35' },
  { id: 'discovercars', label: 'DiscoverCars',  color: '#00a651' },
  { id: 'sendowl',      label: 'SendOwl',       color: '#7c3aed' },
];

const PERIOD_TYPES: { id: PeriodType; label: string }[] = [
  { id: 'week',   label: 'Semaine' },
  { id: 'month',  label: 'Mois' },
  { id: 'year',   label: 'Année' },
  { id: 'custom', label: 'Personnalisée' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtEur(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
}
function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

function PartnerBadge({ partner }: { partner: AffiliationPartner }) {
  const p = PARTNERS.find((x) => x.id === partner);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: p ? `${p.color}20` : '#f3f4f6', color: p?.color ?? '#6b7280' }}>
      {p?.label ?? partner}
    </span>
  );
}

function buildPeriodParams(p: PeriodState): URLSearchParams {
  const qs = new URLSearchParams({ periodType: p.type });
  if (p.type !== 'custom') qs.set('periodValue', p.value);
  else { qs.set('start', p.customStart); qs.set('end', p.customEnd); }
  return qs;
}

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

// ─── PeriodSelector Component ─────────────────────────────────────────────────

function PeriodSelector({ period, onChange }: {
  period: PeriodState;
  onChange: (p: PeriodState) => void;
}) {
  const weeks  = getCurrentYearWeeks();
  const months = getRecentMonths(36);
  const years  = getAvailableYears();

  const setType = (type: PeriodType) => {
    onChange({ ...period, type, value: getDefaultPeriodValue(type) });
  };
  const setValue = (value: string) => onChange({ ...period, value });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Segmented control */}
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

      {/* Secondary selector */}
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
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function getInitialPeriod(): PeriodState {
  const now = new Date();
  return {
    type: 'month',
    value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    customStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    customEnd:   now.toISOString().slice(0, 10),
  };
}

export default function RevenuePage() {
  // --- Period ---
  const [period, setPeriod] = useState<PeriodState>(getInitialPeriod);
  const [chartPeriod, setChartPeriod] = useState<PeriodState>({
    type: 'year',
    value: String(new Date().getFullYear()),
    customStart: '',
    customEnd: '',
  });

  // --- Stats ---
  const [stats, setStats]             = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [siteFilter, setSiteFilter]   = useState('');
  const [sites, setSites]             = useState<Site[]>([]);

  // --- Chart ---
  const [chartData, setChartData]       = useState<RevenueChartPoint[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);

  // --- Import ---
  const [dragOver, setDragOver]               = useState(false);
  const [file, setFile]                       = useState<File | null>(null);
  const [detectedPartner, setDetectedPartner] = useState<AffiliationPartner | null>(null);
  const [partnerOverride, setPartnerOverride] = useState<AffiliationPartner | ''>('');
  const [importing, setImporting]             = useState(false);
  const [importResult, setImportResult]       = useState<ImportResult | null>(null);
  const [importError, setImportError]         = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Recalcul Booking ---
  const [recalculating, setRecalculating]     = useState(false);
  const [recalcResult, setRecalcResult]       = useState<{ message: string; recordsUpdated: number; monthSummary: Array<{ month: string; tier: string; stayedCount: number; stayedSource: 'actual' | 'n1_estimate'; recordsUpdated: number; delta: number }> } | null>(null);

  const handleRecalculate = async () => {
    setRecalculating(true);
    setRecalcResult(null);
    try {
      const res = await fetch('/api/revenue/recalculate', { method: 'POST' });
      const data = await res.json();
      setRecalcResult(data);
      loadStats();
      loadChart();
    } finally {
      setRecalculating(false);
    }
  };

  // --- Tiers Booking (tableau inline + modal) ---
  interface TierRow { monthIndex: number; monthLabel: string; stayedN: number; stayedN1: number; stayedN2: number; tierN: string|null; tierN1: string|null; tierN2: string|null; }
  interface TiersData { yearN: number; yearN1: number; yearN2: number; rows: TierRow[]; }
  const [tiersData, setTiersData]     = useState<TiersData | null>(null);
  const [loadingTiers, setLoadingTiers] = useState(false);
  const [showTiersModal, setShowTiersModal] = useState(false);

  const loadTiers = async () => {
    setLoadingTiers(true);
    try {
      const res  = await fetch('/api/revenue/booking-tiers');
      const data = await res.json();
      setTiersData(data);
    } finally {
      setLoadingTiers(false);
    }
  };

  // --- Promesses par plateforme (date de réservation) ---
  const [promises, setPromises]           = useState<PromisesData | null>(null);
  const [loadingPromises, setLoadingPromises] = useState(false);

  // --- Modal Revenus par mois (check-out) ---
  const [showRevenueModal, setShowRevenueModal]   = useState(false);
  const [monthlyRevenue, setMonthlyRevenue]       = useState<MonthlyRevenueRow[]>([]);
  const [loadingMonthly, setLoadingMonthly]       = useState(false);

  const openRevenueModal = async () => {
    setShowRevenueModal(true);
    if (monthlyRevenue.length > 0) return;
    setLoadingMonthly(true);
    try {
      const res  = await fetch('/api/revenue/booking-monthly');
      const data = await res.json();
      setMonthlyRevenue(data.rows ?? []);
    } finally { setLoadingMonthly(false); }
  };

  // --- Load ---
  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const qs = buildPeriodParams(period);
      if (siteFilter) qs.set('site', siteFilter);
      const res = await fetch(`/api/revenue/stats?${qs}`);
      const data = await res.json();
      if (res.ok) setStats(data);
    } finally { setLoadingStats(false); }
  }, [period, siteFilter]);

  const loadPromises = useCallback(async () => {
    setLoadingPromises(true);
    try {
      const qs = buildPeriodParams(period);
      if (siteFilter) qs.set('site', siteFilter);
      const res = await fetch(`/api/revenue/promises?${qs}`);
      const data = await res.json();
      if (res.ok) setPromises(data);
    } finally { setLoadingPromises(false); }
  }, [period, siteFilter]);

  const loadChart = useCallback(async () => {
    setLoadingChart(true);
    try {
      const qs = buildPeriodParams(chartPeriod);
      if (siteFilter) qs.set('site', siteFilter);
      const res = await fetch(`/api/revenue/chart?${qs}`);
      const data = await res.json();
      if (res.ok) setChartData(data.data ?? []);
    } finally { setLoadingChart(false); }
  }, [chartPeriod, siteFilter]);

  useEffect(() => {
    fetch('/api/sites').then((r) => r.json()).then((d) => setSites(Array.isArray(d) ? d : []));
    loadTiers();
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadPromises(); }, [loadPromises]);
  useEffect(() => { loadChart(); }, [loadChart]);

  // --- File ---
  const handleFileSelect = async (f: File) => {
    setFile(f);
    setImportResult(null);
    setImportError('');
    setDetectedPartner(null);
    setPartnerOverride('');
    const slice = f.slice(0, 1000);
    const text  = await slice.text();
    const firstLine = text.split('\n')[0];
    const headers = firstLine.split(/[,;\t]/).map((h) => h.trim().replace(/^"|"$/g, ''));
    const qs = new URLSearchParams({ headers: headers.join(',') });
    const res  = await fetch(`/api/revenue/import?${qs}`);
    const data = await res.json();
    setDetectedPartner(data.partner ?? null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true); setImportError(''); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (partnerOverride) fd.append('partner', partnerOverride);
      const res  = await fetch('/api/revenue/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) setImportError(data.error || 'Erreur lors de l\'import');
      else { setImportResult(data); loadStats(); loadChart(); }
    } catch { setImportError('Erreur réseau'); }
    finally { setImporting(false); }
  };

  const exportCsv = () => {
    if (!stats) return;
    const rows = [
      ['Site', 'Revenus (€)', 'Sessions', 'RPM'],
      ...stats.bySite.map((s) => [s.siteName, s.revenue.toFixed(2), s.sessions, s.rpm?.toFixed(2) ?? '']),
    ];
    const csv = rows.map((r) => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `revenus-${period.type}-${period.value || 'custom'}.csv`;
    a.click();
  };

  const effectivePartner = partnerOverride || detectedPartner;

  const xAxisFormatter = (v: string) => {
    if (v.length === 10) return v.slice(5).split('-').reverse().join('/');  // YYYY-MM-DD
    if (v.length === 7)  return v.slice(5) + '/' + v.slice(2, 4);         // YYYY-MM
    return v;
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance Revenus</h1>
          <p className="text-sm text-gray-500 mt-0.5">Affiliation — import CSV et analyse par partenaire</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
          >
            <option value="">Tous les sites</option>
            {sites.map((s) => <option key={s._id} value={s.shortName}>{s.shortName}</option>)}
          </select>
          <button onClick={() => { loadStats(); loadChart(); }}
            className="p-2 text-gray-500 hover:text-[#f57503] hover:bg-orange-50 rounded-lg transition-colors">
            <ArrowPathIcon className="w-5 h-5" />
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <ArrowDownTrayIcon className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      {/* ─── Sélecteur de période KPIs ────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <CalendarDaysIcon className="w-5 h-5 text-gray-400 shrink-0" />
          <PeriodSelector period={period} onChange={setPeriod} />
          {stats?.label && (
            <span className="text-sm text-gray-500 ml-auto">{stats.label}</span>
          )}
        </div>
      </div>

      {/* ─── KPI Cards ────────────────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          {/* Total */}
          <div className="col-span-2 sm:col-span-1 lg:col-span-2 bg-gradient-to-br from-[#191E55] to-[#2a3180] rounded-2xl p-5 text-white">
            <p className="text-xs font-medium text-white/60 mb-1">Revenus nets</p>
            <p className="text-2xl font-bold">{loadingStats ? '…' : fmtEur(stats?.totalRevenue ?? 0)}</p>
            {stats?.cancelledCount != null && stats.cancelledCount > 0 && (
              <p className="text-xs text-white/50 mt-1">{stats.cancelledCount} annulé(s)</p>
            )}
            {stats?.rpm != null && (
              <p className="text-xs text-white/70 mt-1">RPM : <span className="font-semibold">{fmtEur(stats.rpm)}</span></p>
            )}
          </div>
          {/* Par partenaire */}
          {PARTNERS.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <p className="text-xs font-medium text-gray-500 truncate">{p.label}</p>
              </div>
              <p className="text-lg font-bold text-gray-900">
                {loadingStats ? '…' : fmtEur(stats?.byPartner[p.id] ?? 0)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Graphiques ───────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <ChartBarIcon className="w-5 h-5 text-[#f57503]" />
            <h3 className="text-sm font-semibold text-gray-900">Évolution des revenus</h3>
          </div>
          <PeriodSelector period={chartPeriod} onChange={setChartPeriod} />
        </div>

        {loadingChart ? (
          <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Chargement…</div>
        ) : chartData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Stacked bar par partenaire */}
            <div>
              <p className="text-xs text-gray-400 mb-2">Par partenaire</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={xAxisFormatter} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}€`} />
                  <Tooltip formatter={(v) => fmtEur(Number(v))} labelFormatter={(v) => xAxisFormatter(String(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {PARTNERS.map((p) => (
                    <Bar key={p.id} dataKey={p.id} name={p.label} stackId="a" fill={p.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Line chart total */}
            <div>
              <p className="text-xs text-gray-400 mb-2">Total</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={xAxisFormatter} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}€`} />
                  <Tooltip formatter={(v) => fmtEur(Number(v))} labelFormatter={(v) => xAxisFormatter(String(v))} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="#f57503" strokeWidth={2} dot={false} />
                  {PARTNERS.map((p) => (
                    <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={p.color} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* ─── Promesses par plateforme ─────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Promesses par plateforme</h2>
            <p className="text-xs text-gray-400 mt-0.5">Réservations faites sur la période (date de réservation)</p>
          </div>
          <div className="flex items-center gap-2">
            {promises?.totalCancelled != null && promises.totalCancelled > 0 && (
              <span className="text-xs text-gray-400 mr-2">{promises.totalCancelled} annulation(s)</span>
            )}
            <button
              onClick={openRevenueModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <CurrencyEuroIcon className="w-3.5 h-3.5" />
              Revenus réalisés
            </button>
            <button
              onClick={() => setShowTiersModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#003580] text-[#003580] hover:bg-blue-50 transition-colors"
            >
              <ChartBarIcon className="w-3.5 h-3.5" />
              Tiers Booking
            </button>
          </div>
        </div>
        {loadingPromises ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Chargement…</div>
        ) : !promises || promises.byPartnerTable.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Aucune donnée pour cette période.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Plateforme</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Comm. estimée</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Réservations</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Annulées</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Taux annulation</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">N-1</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Part</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {promises.byPartnerTable.map((row) => {
                  const p = PARTNERS.find((x) => x.id === row.partner);
                  const share = promises.totalRevenue > 0 ? (row.revenue / promises.totalRevenue) * 100 : 0;
                  return (
                    <tr key={row.partner} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p?.color ?? '#ccc' }} />
                          <span className="font-medium text-gray-900">{p?.label ?? row.partner}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-gray-900">{fmtEur(row.revenue)}</td>
                      <td className="px-5 py-4 text-right text-gray-600">{row.bookingsTotal}</td>
                      <td className="px-5 py-4 text-right text-gray-600">
                        {row.cancelledCount > 0 ? (
                          <span className="text-orange-600 font-medium">{row.cancelledCount}</span>
                        ) : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {row.cancelRate != null ? (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${row.cancelRate >= 20 ? 'bg-red-400' : row.cancelRate >= 10 ? 'bg-orange-400' : 'bg-green-400'}`}
                                  style={{ width: `${Math.min(row.cancelRate, 100)}%` }}
                                />
                              </div>
                              <span className={`text-xs font-medium w-10 text-right ${row.cancelRate >= 20 ? 'text-red-600' : row.cancelRate >= 10 ? 'text-orange-500' : 'text-green-600'}`}>
                                {row.cancelRate.toFixed(1)}%
                              </span>
                            </div>
                            {row.cancelRateN1 != null && (
                              <span className="text-xs text-gray-400 w-full text-right">
                                N-1 : {row.cancelRateN1.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {row.revenueN1 > 0 || row.evolution !== null ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-xs text-gray-500">{fmtEur(row.revenueN1)}</span>
                            {row.evolution !== null ? (
                              <span className={`text-xs font-semibold ${row.evolution > 0 ? 'text-green-600' : row.evolution < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                {row.evolution > 0 ? '▲' : row.evolution < 0 ? '▼' : ''} {Math.abs(row.evolution).toFixed(1)}%
                              </span>
                            ) : <span className="text-xs text-blue-500 font-medium">Nouveau</span>}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: p?.color ?? '#ccc' }} />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="px-5 py-3 text-xs font-semibold text-gray-500">TOTAL</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900">{fmtEur(promises.totalRevenue)}</td>
                  <td className="px-5 py-3 text-right text-gray-600">
                    {promises.byPartnerTable.reduce((s, r) => s + r.bookingsTotal, 0)}
                  </td>
                  <td className="px-5 py-3 text-right text-orange-600 font-medium">
                    {promises.totalCancelled}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {(() => {
                      const total    = promises.byPartnerTable.reduce((s, r) => s + r.bookingsTotal, 0);
                      const rate     = total > 0 ? (promises.totalCancelled / total) * 100 : null;
                      const rateN1   = promises.byPartnerTable.some((r) => r.cancelRateN1 != null)
                        ? promises.byPartnerTable.reduce((s, r) => s + (r.cancelRateN1 ?? 0), 0) / promises.byPartnerTable.filter((r) => r.cancelRateN1 != null).length
                        : null;
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          {rate != null ? (
                            <span className={`text-xs font-semibold ${rate >= 20 ? 'text-red-600' : rate >= 10 ? 'text-orange-500' : 'text-green-600'}`}>
                              {rate.toFixed(1)}%
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                          {rateN1 != null && (
                            <span className="text-xs text-gray-400">N-1 : {rateN1.toFixed(1)}%</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {(() => {
                      const totalN1 = promises.byPartnerTable.reduce((s, r) => s + r.revenueN1, 0);
                      const evo     = totalN1 > 0 ? Math.round(((promises.totalRevenue - totalN1) / totalN1) * 1000) / 10 : null;
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs font-bold text-gray-700">{fmtEur(totalN1)}</span>
                          {evo !== null && (
                            <span className={`text-xs font-semibold ${evo > 0 ? 'text-green-600' : evo < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                              {evo > 0 ? '▲' : evo < 0 ? '▼' : ''} {Math.abs(evo).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* ─── Recalcul Booking ─────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowPathIcon className="w-5 h-5 text-[#003580]" />
            <h2 className="text-base font-semibold text-gray-900">Commissions Booking.com</h2>
          </div>
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-[#003580] text-white hover:bg-blue-900 transition-colors disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
            {recalculating ? 'Recalcul en cours…' : 'Recalculer les tiers'}
          </button>
        </div>

        {/* Tableau stayed N-2 / N-1 / N */}
        <div className="px-6 py-5">
          {loadingTiers ? (
            <p className="text-sm text-gray-400">Chargement…</p>
          ) : tiersData ? (() => {
            const { yearN, yearN1, yearN2, rows } = tiersData;
            const tierClass = (t: string | null) =>
              t === '40%' ? 'text-green-600 font-semibold' :
              t === '35%' ? 'text-blue-600 font-semibold' :
              t === '30%' ? 'text-orange-500 font-semibold' :
              t === '25%' ? 'text-gray-500 font-medium' : 'text-gray-300';

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-2 pr-6 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Mois</th>
                      <th className="py-2 px-4 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">{yearN2}</th>
                      <th className="py-2 px-4 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">{yearN1}</th>
                      <th className="py-2 pl-4 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">{yearN}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((row) => (
                      <tr key={row.monthIndex} className="hover:bg-gray-50/60">
                        <td className="py-2.5 pr-6 font-medium text-gray-700">{row.monthLabel}</td>
                        <td className="py-2.5 px-4 text-center">
                          {row.stayedN2 > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-gray-600">{row.stayedN2.toLocaleString('fr-FR')}</span>
                              <span className={`text-xs ${tierClass(row.tierN2)}`}>{row.tierN2}</span>
                            </span>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {row.stayedN1 > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-gray-600">{row.stayedN1.toLocaleString('fr-FR')}</span>
                              <span className={`text-xs ${tierClass(row.tierN1)}`}>{row.tierN1}</span>
                            </span>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                        <td className="py-2.5 pl-4 text-center">
                          {row.stayedN > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-gray-700 font-medium">{row.stayedN.toLocaleString('fr-FR')}</span>
                              <span className={`text-xs ${tierClass(row.tierN)}`}>{row.tierN}</span>
                            </span>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-gray-400">Couleurs : <span className="text-gray-500 font-medium">25%</span> · <span className="text-orange-500 font-semibold">30%</span> · <span className="text-blue-600 font-semibold">35%</span> · <span className="text-green-600 font-semibold">40%</span></p>
              </div>
            );
          })() : null}
        </div>

        {recalcResult && (
          <div className="px-6 pb-5 space-y-2 border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-gray-800">{recalcResult.message}</p>
            {recalcResult.monthSummary.length === 0 ? (
              <p className="text-sm text-green-600">Tous les tiers étaient déjà corrects.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-semibold uppercase tracking-wide">Mois</th>
                      <th className="px-3 py-2 text-right text-gray-500 font-semibold uppercase tracking-wide">Stayed</th>
                      <th className="px-3 py-2 text-right text-gray-500 font-semibold uppercase tracking-wide">Source</th>
                      <th className="px-3 py-2 text-right text-gray-500 font-semibold uppercase tracking-wide">Tier</th>
                      <th className="px-3 py-2 text-right text-gray-500 font-semibold uppercase tracking-wide">Enreg. maj</th>
                      <th className="px-3 py-2 text-right text-gray-500 font-semibold uppercase tracking-wide">Δ revenus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recalcResult.monthSummary.map((r) => (
                      <tr key={r.month} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-medium text-gray-800">{r.month}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{r.stayedCount}</td>
                        <td className="px-3 py-2 text-right">
                          {r.stayedSource === 'actual'
                            ? <span className="text-xs text-green-600 font-medium">Réel</span>
                            : <span className="text-xs text-orange-500 font-medium">N-1 est.</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`font-semibold ${r.tier === '40%' ? 'text-green-600' : r.tier === '35%' ? 'text-blue-600' : r.tier === '30%' ? 'text-orange-500' : 'text-gray-500'}`}>
                            {r.tier}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{r.recordsUpdated}</td>
                        <td className={`px-3 py-2 text-right font-medium ${r.delta > 0 ? 'text-green-600' : r.delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                          {r.delta > 0 ? '+' : ''}{r.delta.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── Import CSV ───────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <DocumentArrowUpIcon className="w-5 h-5 text-[#f57503]" />
          <h2 className="text-base font-semibold text-gray-900">Import CSV affiliation</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Drop zone */}
            <div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-[#f57503] bg-orange-50' : 'border-gray-200 hover:border-[#f57503] hover:bg-orange-50/30'
                }`}
              >
                <ArrowUpTrayIcon className="w-8 h-8 mx-auto mb-3 text-gray-400" />
                {file ? (
                  <div>
                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} Ko</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Glissez votre CSV ici</p>
                    <p className="text-xs text-gray-400 mt-1">ou cliquez pour sélectionner</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
              </div>

              {file && (
                <div className="mt-4 p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs font-medium text-gray-500 mb-2">Partenaire détecté</p>
                  <div className="flex items-center gap-3">
                    {detectedPartner ? <PartnerBadge partner={detectedPartner} /> : <span className="text-xs text-gray-400">Non reconnu automatiquement</span>}
                    <select
                      value={partnerOverride}
                      onChange={(e) => setPartnerOverride(e.target.value as AffiliationPartner | '')}
                      className="ml-auto text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                    >
                      <option value="">Détection auto</option>
                      {PARTNERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Résultat + info */}
            <div className="flex flex-col justify-between gap-4">
              <div className="space-y-3">
                {importResult && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircleIcon className="w-5 h-5 text-green-600" />
                      <p className="text-sm font-semibold text-green-800">Import réussi</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-green-700">
                      <span>Insérés : <strong>{importResult.inserted}</strong></span>
                      <span>Doublons : <strong>{importResult.duplicates}</strong></span>
                      <span>Ignorés : <strong>{importResult.skipped}</strong></span>
                      {importResult.cancelled != null && importResult.cancelled > 0 && (
                        <span>Annulés : <strong>{importResult.cancelled}</strong></span>
                      )}
                      <span className="col-span-2 border-t border-green-200 pt-1 mt-1">
                        Commission nette : <strong>{fmtEur(importResult.totalCommission)}</strong>
                        {importResult.cancelled != null && importResult.cancelled > 0 && importResult.totalCommissionWithCancelled != null && (
                          <span className="text-green-500 ml-2">(brut : {fmtEur(importResult.totalCommissionWithCancelled)})</span>
                        )}
                      </span>
                    </div>
                    {importResult.errors.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-orange-600 cursor-pointer">{importResult.errors.length} avertissement(s)</summary>
                        <ul className="mt-1 text-xs text-orange-600 space-y-0.5">
                          {importResult.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
                {importError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <ExclamationTriangleIcon className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700">{importError}</p>
                  </div>
                )}
                <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 space-y-1">
                  <p className="font-medium mb-1">Formats acceptés :</p>
                  {PARTNERS.map((p) => (
                    <div key={p.id} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.label}
                    </div>
                  ))}
                  <p className="text-blue-500 mt-2">Note : les revenus Canarias avec code <strong>CAL</strong> sont attribués au site "Canarias".</p>
                </div>
              </div>

              <button
                onClick={handleImport}
                disabled={!file || !effectivePartner || importing}
                className="w-full py-2.5 text-sm font-medium text-white bg-[#f57503] rounded-xl hover:bg-[#e06a02] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {importing ? <><ArrowPathIcon className="w-4 h-4 animate-spin" />Import…</> : 'Ingérer la donnée'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Tableau par site ─────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Revenus par site</h2>
          {stats?.bySite && <p className="text-xs text-gray-400">{stats.bySite.length} sites</p>}
        </div>
        {loadingStats ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">Chargement…</div>
        ) : !stats || stats.bySite.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">
            Aucune donnée pour cette période.{' '}
            <span className="text-[#f57503]">Importez un CSV ci-dessus.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Site</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Revenus</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Sessions</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">RPM</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Part</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stats.bySite.map((row, idx) => {
                  const share = stats.totalRevenue > 0 ? (row.revenue / stats.totalRevenue) * 100 : 0;
                  return (
                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-4 font-medium text-gray-900">
                        {row.siteName || <span className="text-gray-400 italic">Non attribué</span>}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-gray-900">{fmtEur(row.revenue)}</td>
                      <td className="px-5 py-4 text-right text-gray-600">
                        {row.sessions > 0 ? fmtNum(row.sessions) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {row.rpm != null
                          ? <span className={`font-medium ${row.rpm >= 5 ? 'text-green-600' : row.rpm >= 2 ? 'text-orange-500' : 'text-red-500'}`}>{fmtEur(row.rpm)}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-[#f57503] rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="px-5 py-3 text-xs font-semibold text-gray-500">TOTAL</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900">{fmtEur(stats.totalRevenue)}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{fmtNum(stats.totalSessions)}</td>
                  <td className="px-5 py-3 text-right">
                    {stats.rpm != null ? <span className="font-semibold text-[#f57503]">{fmtEur(stats.rpm)}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* ─── Modale : Revenus réalisés par mois de check-out ────────────────── */}
      {showRevenueModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#003580] rounded-xl flex items-center justify-center shrink-0">
                  <CurrencyEuroIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Revenus réalisés — Booking.com</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Commission perçue par mois de check-out</p>
                </div>
              </div>
              <button onClick={() => setShowRevenueModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {loadingMonthly ? (
                <div className="py-12 text-center text-gray-400 text-sm">Chargement…</div>
              ) : monthlyRevenue.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">Aucune donnée (check-out date requis).</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-2 pr-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Mois check-out</th>
                      <th className="py-2 px-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Revenus</th>
                      <th className="py-2 px-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Séjours</th>
                      <th className="py-2 pl-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Stayed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {monthlyRevenue.map((row) => (
                      <tr key={row.month} className="hover:bg-gray-50/60">
                        <td className="py-2.5 pr-4 font-medium text-gray-700">{row.monthLabel}</td>
                        <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{fmtEur(row.revenue)}</td>
                        <td className="py-2.5 px-3 text-right text-gray-600">{row.bookings.toLocaleString('fr-FR')}</td>
                        <td className="py-2.5 pl-3 text-right text-gray-500">{row.stayed.toLocaleString('fr-FR')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200">
                    <tr>
                      <td className="py-2.5 pr-4 text-xs font-semibold text-gray-500 uppercase">Total</td>
                      <td className="py-2.5 px-3 text-right font-bold text-gray-900">{fmtEur(monthlyRevenue.reduce((s, r) => s + r.revenue, 0))}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-700">{monthlyRevenue.reduce((s, r) => s + r.bookings, 0).toLocaleString('fr-FR')}</td>
                      <td className="py-2.5 pl-3 text-right font-semibold text-gray-600">{monthlyRevenue.reduce((s, r) => s + r.stayed, 0).toLocaleString('fr-FR')}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Modale : Tiers Booking ─────────────────────────────────────────── */}
      {showTiersModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#003580] rounded-xl flex items-center justify-center shrink-0">
                  <ChartBarIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Tiers de commission Booking.com</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Séjours "Stayed" par mois de check-in · <span className="text-gray-500 font-medium">25%</span> · <span className="text-orange-500 font-medium">30%</span> · <span className="text-blue-600 font-medium">35%</span> · <span className="text-green-600 font-medium">40%</span></p>
                </div>
              </div>
              <button onClick={() => setShowTiersModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {loadingTiers ? (
                <div className="py-12 text-center text-gray-400 text-sm">Chargement…</div>
              ) : !tiersData ? (
                <div className="py-12 text-center text-gray-400 text-sm">Aucune donnée Booking importée.</div>
              ) : (() => {
                const { yearN, yearN1, yearN2, rows } = tiersData;
                const tierClass = (t: string | null) =>
                  t === '40%' ? 'text-green-600 font-semibold' :
                  t === '35%' ? 'text-blue-600 font-semibold' :
                  t === '30%' ? 'text-orange-500 font-semibold' :
                  t === '25%' ? 'text-gray-500 font-medium' : 'text-gray-300';
                return (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="py-2 pr-6 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Mois</th>
                        <th className="py-2 px-4 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">{yearN2}</th>
                        <th className="py-2 px-4 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">{yearN1}</th>
                        <th className="py-2 pl-4 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">{yearN}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map((row) => (
                        <tr key={row.monthIndex} className="hover:bg-gray-50/60">
                          <td className="py-2.5 pr-6 font-medium text-gray-700">{row.monthLabel}</td>
                          <td className="py-2.5 px-4 text-center">
                            {row.stayedN2 > 0 ? <span className="inline-flex items-center gap-1.5"><span className="text-gray-600">{row.stayedN2.toLocaleString('fr-FR')}</span><span className={`text-xs ${tierClass(row.tierN2)}`}>{row.tierN2}</span></span> : <span className="text-gray-200">—</span>}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {row.stayedN1 > 0 ? <span className="inline-flex items-center gap-1.5"><span className="text-gray-600">{row.stayedN1.toLocaleString('fr-FR')}</span><span className={`text-xs ${tierClass(row.tierN1)}`}>{row.tierN1}</span></span> : <span className="text-gray-200">—</span>}
                          </td>
                          <td className="py-2.5 pl-4 text-center">
                            {row.stayedN > 0 ? <span className="inline-flex items-center gap-1.5"><span className="text-gray-700 font-medium">{row.stayedN.toLocaleString('fr-FR')}</span><span className={`text-xs ${tierClass(row.tierN)}`}>{row.tierN}</span></span> : <span className="text-gray-200">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
