'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ChartBarIcon,
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
import type { AffiliationPartner } from '@/lib/models/revenue';
import RevenuePeriodSelector, {
  buildPeriodParams,
  getInitialPeriod,
  type PeriodState,
} from '@/components/RevenuePeriodSelector';

type PartnerRow = {
  partner: AffiliationPartner;
  revenue: number;
  revenueN1: number;
  evolution: number | null;
  bookingsTotal: number;
  cancelledCount: number;
  cancelRate: number | null;
  cancelRateN1: number | null;
};

type PromisesData = {
  byPartnerTable: PartnerRow[];
  totalRevenue: number;
  totalCancelled: number;
  startStr: string;
  endStr: string;
};

type PromisesEvolutionRow = {
  month: string; // YYYY-MM-DD (day) or YYYY-MM (month)
  total: number | null;
  totalN1: number | null;
};

type PromisesEvolutionData = {
  granularity: string;
  startStr: string;
  endStr: string;
  data: PromisesEvolutionRow[];
};

type PromisesBySiteRow = {
  siteName: string;
  revenue: number;
  revenueN1: number;
  evolution: number | null;
  bookingsTotal: number;
  cancelledCount: number;
  cancelRate: number | null;
  cancelRateN1: number | null;
  sharePct: number;
};

type PromisesBySiteData = {
  startStr: string;
  endStr: string;
  totalRevenue: number;
  bySite: PromisesBySiteRow[];
};

type MappingKind = 'affiliateId' | 'productName';

type UnassignedGroup = {
  partner: AffiliationPartner;
  mappingKind: MappingKind;
  mappingKey: string;
  reason: string;
  exampleReservationCity?: string;
  exampleReservationCountry?: string;
  revenue: number;
  count: number;
  exampleOrderId: string;
  exampleDateStr: string;
};

interface Site { _id: string; shortName: string; name: string; }

const PARTNERS: { id: AffiliationPartner; label: string; color: string }[] = [
  { id: 'getyourguide', label: 'GetYourGuide', color: '#FF5533' },
  { id: 'booking',      label: 'Booking.com',  color: '#003580' },
  { id: 'tiqets',       label: 'Tiqets',       color: '#ff6b35' },
  { id: 'discovercars', label: 'DiscoverCars', color: '#00a651' },
  { id: 'sendowl',      label: 'SendOwl',       color: '#7c3aed' },
];

function fmtEur(n: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(n);
}

export default function PromisesPage() {
  const todayLocalStr = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  const [period, setPeriod] = useState<PeriodState>(() => getInitialPeriod());
  const [siteFilter, setSiteFilter] = useState('');
  const [sites, setSites] = useState<Site[]>([]);

  const [promises, setPromises] = useState<PromisesData | null>(null);
  const [loadingPromises, setLoadingPromises] = useState(false);

  const [promisesEvolution, setPromisesEvolution] = useState<PromisesEvolutionData | null>(null);
  const [loadingPromisesEvolution, setLoadingPromisesEvolution] = useState(false);

  const [promisesBySite, setPromisesBySite] = useState<PromisesBySiteData | null>(null);
  const [loadingPromisesBySite, setLoadingPromisesBySite] = useState(false);

  // --- Insights modal (12 mois vs N-1 + répartition promesses + non attribués) ---
  type Insights12mPoint = { month: string; total: number; totalN1: number };
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [loadingInsightsModal, setLoadingInsightsModal] = useState(false);
  const [insights12m, setInsights12m] = useState<Insights12mPoint[]>([]);
  const [nonAttributedByPartner, setNonAttributedByPartner] = useState<Record<AffiliationPartner, UnassignedGroup[]>>({
    getyourguide: [], booking: [], tiqets: [], discovercars: [], sendowl: [],
  });
  const [assignSiteByGroupId, setAssignSiteByGroupId] = useState<Record<string, string>>({});
  const [assigningGroupId, setAssigningGroupId] = useState<Record<string, boolean>>({});
  const [nonAttributedLastLoadedKey, setNonAttributedLastLoadedKey] = useState<string>('');
  const [insightsAssignMsg, setInsightsAssignMsg] = useState<string>('');
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignMsg, setAutoAssignMsg] = useState<string>('');

  const loadSites = useCallback(async () => {
    const res = await fetch('/api/sites');
    const d = await res.json();
    setSites(Array.isArray(d) ? d : []);
  }, []);

  const loadPromises = useCallback(async () => {
    setLoadingPromises(true);
    try {
      const qs = buildPeriodParams(period);
      if (siteFilter) qs.set('site', siteFilter);
      qs.set('today', todayLocalStr);

      const res = await fetch(`/api/revenue/promises?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setPromises(data);
    } finally {
      setLoadingPromises(false);
    }
  }, [period, siteFilter, todayLocalStr]);

  const loadPromisesEvolution = useCallback(async () => {
    setLoadingPromisesEvolution(true);
    try {
      const qs = buildPeriodParams(period);
      if (siteFilter) qs.set('site', siteFilter);
      qs.set('today', todayLocalStr);
      const res = await fetch(`/api/revenue/promises/chart?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setPromisesEvolution(data);
    } finally {
      setLoadingPromisesEvolution(false);
    }
  }, [period, siteFilter, todayLocalStr]);

  const loadPromisesBySite = useCallback(async () => {
    setLoadingPromisesBySite(true);
    try {
      const qs = buildPeriodParams(period);
      if (siteFilter) qs.set('site', siteFilter);
      qs.set('today', todayLocalStr);
      const res = await fetch(`/api/revenue/promises/by-site?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setPromisesBySite(data);
    } finally {
      setLoadingPromisesBySite(false);
    }
  }, [period, siteFilter, todayLocalStr]);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    loadPromises();
  }, [loadPromises]);

  useEffect(() => {
    loadPromisesEvolution();
  }, [loadPromisesEvolution]);

  useEffect(() => {
    loadPromisesBySite();
  }, [loadPromisesBySite]);

  const xAxisFormatter = (v: string) => {
    if (v.length === 10) return v.slice(8, 10) + '/' + v.slice(5, 7); // DD/MM
    if (v.length === 7) return v.slice(5) + '/' + v.slice(2, 4); // MM/YY
    return v;
  };

  const groupIdForNonAttributed = (g: UnassignedGroup) => `${g.partner}|${g.mappingKind}|${g.mappingKey}`;

  const shiftYearBackDateStr = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };

  const getLast12MonthsRange = () => {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const start = startDate.toISOString().slice(0, 10);
    return { start, end };
  };

  const loadNonAttributed = useCallback(async (force = false) => {
    const keyParts = [period.type, period.value || '', period.customStart || '', period.customEnd || '', siteFilter || ''];
    const key = keyParts.join('|');
    if (!force && key === nonAttributedLastLoadedKey) return;

    const qs = buildPeriodParams(period);
    if (siteFilter) qs.set('site', siteFilter);
    qs.set('today', todayLocalStr);

    const res = await fetch(`/api/revenue/promises/non-attributed?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');

    setNonAttributedByPartner(data.groupsByPartner ?? {
      getyourguide: [], booking: [], tiqets: [], discovercars: [], sendowl: [],
    });
    setNonAttributedLastLoadedKey(key);
  }, [period, siteFilter, nonAttributedLastLoadedKey, todayLocalStr]);

  const loadInsights12m = useCallback(async () => {
    const { start, end } = getLast12MonthsRange();
    const startN1 = shiftYearBackDateStr(start);
    const endN1 = shiftYearBackDateStr(end);

    const qsN = new URLSearchParams({ periodType: 'custom', start, end, today: todayLocalStr });
    if (siteFilter) qsN.set('site', siteFilter);
    const qsN1 = new URLSearchParams({ periodType: 'custom', start: startN1, end: endN1, today: todayLocalStr });
    if (siteFilter) qsN1.set('site', siteFilter);

    const [resN, resN1] = await Promise.all([
      fetch(`/api/revenue/promises/chart?${qsN}`),
      fetch(`/api/revenue/promises/chart?${qsN1}`),
    ]);
    const dataN = await resN.json();
    const dataN1 = await resN1.json();
    if (!resN.ok) throw new Error(dataN.error || 'Erreur chart N');
    if (!resN1.ok) throw new Error(dataN1.error || 'Erreur chart N-1');

    const curPoints = (dataN.data ?? []).sort((a: any, b: any) => String(a.month).localeCompare(String(b.month)));
    const prevPoints = (dataN1.data ?? []).sort((a: any, b: any) => String(a.month).localeCompare(String(b.month)));

    const len = Math.max(curPoints.length, prevPoints.length);
    const points: Insights12mPoint[] = [];
    for (let i = 0; i < len; i++) {
      const p = curPoints[i];
      const p1 = prevPoints[i];
      if (!p && !p1) continue;
      points.push({
        month: p?.month ?? p1?.month ?? '',
        total: Number(p?.total ?? 0),
        totalN1: Number(p1?.total ?? 0),
      });
    }
    setInsights12m(points);
  }, [siteFilter, todayLocalStr]);

  const openInsightsModal = useCallback(async () => {
    setShowInsightsModal(true);
    setAssignSiteByGroupId({});
    setAssigningGroupId({});
    setInsightsAssignMsg('');
    setAutoAssignMsg('');
    setLoadingInsightsModal(true);
    try {
      await loadNonAttributed();
      await loadInsights12m();
    } catch (e) {
      setInsightsAssignMsg(e instanceof Error ? e.message : 'Erreur chargement insights');
    } finally {
      setLoadingInsightsModal(false);
    }
  }, [loadNonAttributed, loadInsights12m]);

  const assignNonAttributedGroup = useCallback(async (g: UnassignedGroup) => {
    const gid = groupIdForNonAttributed(g);
    const targetSiteName = (assignSiteByGroupId[gid] ?? '').trim();
    if (!targetSiteName) return;

    setInsightsAssignMsg('');
    setAssigningGroupId((prev) => ({ ...prev, [gid]: true }));
    try {
      const payload = {
        partner: g.partner,
        mappingKind: g.mappingKind,
        mappingKey: g.mappingKey,
        siteName: targetSiteName,
        periodType: period.type,
        periodValue: period.type !== 'custom' ? period.value : undefined,
        start: period.type === 'custom' ? period.customStart : undefined,
        end: period.type === 'custom' ? period.customEnd : undefined,
        today: todayLocalStr,
      };

      const res = await fetch('/api/revenue/promises/non-attributed/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur affectation');

      setInsightsAssignMsg(`Affectation OK (${data.updatedCount ?? 0} enregistrements).`);
      await loadPromisesBySite();
      await loadPromises();
      await loadNonAttributed(true);
      await loadInsights12m();
    } catch (e) {
      setInsightsAssignMsg(e instanceof Error ? e.message : 'Erreur affectation');
    } finally {
      setAssigningGroupId((prev) => ({ ...prev, [gid]: false }));
    }
  }, [assignSiteByGroupId, period, todayLocalStr, loadPromisesBySite, loadPromises, loadNonAttributed, loadInsights12m]);

  const autoAssignNonAttributed = useCallback(async () => {
    setAutoAssigning(true);
    setAutoAssignMsg('');
    try {
      const payload = {
        periodType: period.type,
        periodValue: period.type !== 'custom' ? period.value : undefined,
        start: period.type === 'custom' ? period.customStart : undefined,
        end: period.type === 'custom' ? period.customEnd : undefined,
        today: todayLocalStr,
      };
      const res = await fetch('/api/revenue/promises/non-attributed/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur auto-assign');

      setAutoAssignMsg(`Réaffectation OK : ${data.updated ?? 0} affecté(s).`);
      await loadPromisesBySite();
      await loadPromises();
      await loadNonAttributed(true);
      await loadInsights12m();
    } catch (e) {
      setAutoAssignMsg(e instanceof Error ? e.message : 'Erreur auto-assign');
    } finally {
      setAutoAssigning(false);
    }
  }, [period, todayLocalStr, loadPromisesBySite, loadPromises, loadNonAttributed, loadInsights12m]);

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Promesses</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Affiliation — réservations sur la période (date de réservation)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
          >
            <option value="">Tous les sites</option>
            {sites.map((s) => (
              <option key={s._id} value={s.shortName}>
                {s.shortName}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              loadPromises();
              loadPromisesEvolution();
              loadPromisesBySite();
            }}
            disabled={loadingPromises || loadingPromisesEvolution || loadingPromisesBySite}
            title="Actualiser"
            className="p-2 text-gray-500 hover:text-[#f57503] hover:bg-orange-50 rounded-lg transition-colors disabled:opacity-40"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Période */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <CalendarDaysIcon className="w-5 h-5 text-gray-400 shrink-0" />
          <RevenuePeriodSelector period={period} onChange={setPeriod} />
          {promises?.startStr && promises?.endStr && (
            <span className="text-sm text-gray-500 ml-auto">
              {promises.startStr} → {promises.endStr}
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Évolution des promesses</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Commission estimée (N vs N-1) sur la période (date de réservation)
            </p>
          </div>
          {promises?.totalCancelled != null && promises.totalCancelled > 0 && (
            <span className="text-xs text-gray-400">{promises.totalCancelled} annulation(s)</span>
          )}
        </div>

        <div className="px-6 py-5">
          {loadingPromisesEvolution ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Chargement…</div>
          ) : !promisesEvolution || promisesEvolution.data.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={promisesEvolution.data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v) => xAxisFormatter(String(v))}
                />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={(v) => `${v}€`} />
                <Tooltip
                  formatter={(v) => (v == null ? ['—', ''] : [fmtEur(Number(v)), ''])}
                  labelFormatter={(v) => xAxisFormatter(String(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" name="N" stroke="#f57503" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="totalN1" name="N-1" stroke="#191E55" strokeWidth={1.5} strokeDasharray="4 2" dot={false} activeDot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Table plateforme */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Promesses par plateforme</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Réservations faites sur la période (date de réservation)
            </p>
          </div>
          {promises?.totalCancelled != null && promises.totalCancelled > 0 && (
            <span className="text-xs text-gray-400">
              {promises.totalCancelled} annulation(s)
            </span>
          )}
        </div>

        {loadingPromises ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Chargement…</div>
        ) : !promises || promises.byPartnerTable.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">
            Aucune donnée pour cette période.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Plateforme
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Comm. estimée
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Réservations
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Annulées
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Taux annulation
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    N-1
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Part
                  </th>
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
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: p?.color ?? '#ccc' }}
                          />
                          <span className="font-medium text-gray-900">{p?.label ?? row.partner}</span>
                        </div>
                      </td>

                      <td className="px-5 py-4 text-right font-semibold text-gray-900">{fmtEur(row.revenue)}</td>
                      <td className="px-5 py-4 text-right text-gray-600">{row.bookingsTotal}</td>

                      <td className="px-5 py-4 text-right text-gray-600">
                        {row.cancelledCount > 0 ? (
                          <span className="text-orange-600 font-medium">{row.cancelledCount}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-right">
                        {row.cancelRate != null ? (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    row.cancelRate >= 20
                                      ? 'bg-red-400'
                                      : row.cancelRate >= 10
                                        ? 'bg-orange-400'
                                        : 'bg-green-400'
                                  }`}
                                  style={{ width: `${Math.min(row.cancelRate, 100)}%` }}
                                />
                              </div>
                              <span
                                className={`text-xs font-medium w-10 text-right ${
                                  row.cancelRate >= 20
                                    ? 'text-red-600'
                                    : row.cancelRate >= 10
                                      ? 'text-orange-500'
                                      : 'text-green-600'
                                }`}
                              >
                                {row.cancelRate.toFixed(1)}%
                              </span>
                            </div>

                            {row.cancelRateN1 != null && (
                              <span className="text-xs text-gray-400 w-full text-right">
                                N-1 : {row.cancelRateN1.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-right">
                        {row.revenueN1 > 0 || row.evolution !== null ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-xs text-gray-500">{fmtEur(row.revenueN1)}</span>
                            {row.evolution !== null ? (
                              <span
                                className={`text-xs font-semibold ${
                                  row.evolution > 0
                                    ? 'text-green-600'
                                    : row.evolution < 0
                                      ? 'text-red-500'
                                      : 'text-gray-400'
                                }`}
                              >
                                {row.evolution > 0 ? '▲' : row.evolution < 0 ? '▼' : ''}{' '}
                                {Math.abs(row.evolution).toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-xs text-blue-500 font-medium">Nouveau</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${share}%`, backgroundColor: p?.color ?? '#ccc' }}
                            />
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
                  <td className="px-5 py-3 text-right text-orange-600 font-medium">{promises.totalCancelled}</td>
                  <td className="px-5 py-3 text-right">
                    {(() => {
                      const total = promises.byPartnerTable.reduce((s, r) => s + r.bookingsTotal, 0);
                      const rate = total > 0 ? (promises.totalCancelled / total) * 100 : null;
                      return rate != null ? (
                        <span className={`text-xs font-semibold ${
                          rate >= 20 ? 'text-red-600' : rate >= 10 ? 'text-orange-500' : 'text-green-600'
                        }`}>
                          {rate.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {(() => {
                      const totalN1 = promises.byPartnerTable.reduce((s, r) => s + r.revenueN1, 0);
                      const evo = totalN1 > 0
                        ? Math.round(((promises.totalRevenue - totalN1) / totalN1) * 1000) / 10
                        : null;

                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs font-bold text-gray-700">{fmtEur(totalN1)}</span>
                          {evo !== null && (
                            <span
                              className={`text-xs font-semibold ${
                                evo > 0 ? 'text-green-600' : evo < 0 ? 'text-red-500' : 'text-gray-400'
                              }`}
                            >
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

      {/* Table site */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Promesses par site</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Répartition des promesses par site sur la période (date de réservation)
            </p>
          </div>
          {promisesBySite?.bySite?.length != null && (
            <span className="text-xs text-gray-400">
              {promisesBySite.bySite.length} site(s)
            </span>
          )}
        </div>

        {loadingPromisesBySite ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Chargement…</div>
        ) : !promisesBySite || promisesBySite.bySite.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">
            Aucune donnée pour cette période.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Site
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Comm. estimée
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Réservations
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Annulées
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Taux annulation
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    N-1
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Part
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50">
                {promisesBySite.bySite.map((row) => (
                  <tr key={row.siteName} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-4">
                      {row.siteName === 'Non attribué' ? (
                        <button
                          type="button"
                          onClick={openInsightsModal}
                          className="text-gray-400 italic hover:text-[#f57503] hover:underline font-medium"
                          title="Voir le détail des promesses non attribuées"
                        >
                          Non attribué
                        </button>
                      ) : (
                        <span className="font-medium text-gray-900">{row.siteName}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-gray-900">{fmtEur(row.revenue)}</td>
                    <td className="px-5 py-4 text-right text-gray-600">{row.bookingsTotal}</td>
                    <td className="px-5 py-4 text-right text-gray-600">{row.cancelledCount}</td>
                    <td className="px-5 py-4 text-right">
                      {row.cancelRate != null ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs font-medium text-gray-900">{row.cancelRate.toFixed(1)}%</span>
                          {row.cancelRateN1 != null && (
                            <span className="text-xs text-gray-400">N-1 : {row.cancelRateN1.toFixed(1)}%</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {row.revenueN1 > 0 || row.evolution !== null ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-gray-500">{fmtEur(row.revenueN1)}</span>
                          {row.evolution !== null && (
                            <span className={`text-xs font-semibold ${row.evolution > 0 ? 'text-green-600' : row.evolution < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                              {row.evolution > 0 ? '▲' : row.evolution < 0 ? '▼' : ''} {Math.abs(row.evolution).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-xs text-gray-500">{row.sharePct.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Modale : Insights (12 mois vs N-1 + répartition + non attribués) ───────── */}
      {showInsightsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#191E55] rounded-xl flex items-center justify-center shrink-0">
                  <ChartBarIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Insights promesses + non attribuées</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    12 derniers mois (N) vs N-1 · Répartition sources · Détail non attribué
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowInsightsModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
                title="Fermer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
              {loadingInsightsModal ? (
                <div className="py-12 text-center text-gray-400 text-sm">Chargement…</div>
              ) : (
                <>
                  {/* Top: graph 12 mois + répartition sources */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-white rounded-2xl border border-gray-100 p-5">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div className="flex items-center gap-2">
                          <ChartBarIcon className="w-5 h-5 text-[#f57503]" />
                          <h3 className="text-sm font-semibold text-gray-900">Promesses — 12 mois (total)</h3>
                        </div>
                        <span className="text-xs text-gray-400">N vs N-1</span>
                      </div>

                      {insights12m.length === 0 ? (
                        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={insights12m} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                            <XAxis
                              dataKey="month"
                              tick={{ fontSize: 10, fill: '#9ca3af' }}
                              tickFormatter={(v) => xAxisFormatter(String(v))}
                            />
                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={(v) => `${v}€`} />
                            <Tooltip
                              formatter={(v) => fmtEur(Number(v))}
                              labelFormatter={(v) => xAxisFormatter(String(v))}
                              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Line type="monotone" dataKey="total" name="N" stroke="#f57503" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                            <Line type="monotone" dataKey="totalN1" name="N-1" stroke="#191E55" strokeWidth={1.5} strokeDasharray="4 2" dot={false} activeDot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    <div className="bg-white rounded-2xl border border-gray-100 p-5">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div className="flex items-center gap-2">
                          <ChartBarIcon className="w-5 h-5 text-[#191E55]" />
                          <h3 className="text-sm font-semibold text-gray-900">Répartition sources (période)</h3>
                        </div>
                        <span className="text-xs text-gray-400">N vs N-1</span>
                      </div>

                      {!promises ? (
                        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Chargement…</div>
                      ) : (
                        (() => {
                          const totalN = promises.totalRevenue;
                          const byN1 = Object.fromEntries(promises.byPartnerTable.map((r) => [r.partner, r.revenueN1])) as Record<AffiliationPartner, number>;
                          const totalN1 = Object.values(byN1).reduce((s, v) => s + (v || 0), 0);

                          return (
                            <div className="space-y-3">
                              {PARTNERS.map((p) => {
                                const rn = (promises.byPartnerTable.find((x) => x.partner === p.id)?.revenue ?? 0) as number;
                                const rn1 = byN1[p.id] ?? 0;
                                const shareN = totalN > 0 ? (rn / totalN) * 100 : 0;
                                const shareN1 = totalN1 > 0 ? (rn1 / totalN1) * 100 : 0;
                                const delta = rn1 > 0 ? ((rn - rn1) / rn1) * 100 : null;

                                return (
                                  <div key={p.id} className="rounded-xl border border-gray-100 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                                        <span className="text-sm font-semibold text-gray-900">{p.label}</span>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-sm font-bold text-gray-900">{fmtEur(rn)}</div>
                                        <div className="text-xs text-gray-400">N-1 : {fmtEur(rn1)}</div>
                                      </div>
                                    </div>

                                    <div className="mt-3">
                                      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                                        <span>{shareN.toFixed(1)}%</span>
                                        <span>{totalN1 > 0 ? `${shareN1.toFixed(1)}%` : '—'}</span>
                                      </div>
                                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, shareN)}%`, backgroundColor: p.color }} />
                                      </div>
                                      {delta !== null && (
                                        <div className={`text-xs mt-2 font-medium ${delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                          {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs N-1
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>

                  {/* Non attribués */}
                  <div className="bg-white rounded-2xl border border-gray-100 p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Non attribuées — détail & affectation manuelle</h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Les clés ci-dessous correspondent aux identifiants utilisés lors du mapping (affiliateId / produit/campaign).
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <button
                          onClick={autoAssignNonAttributed}
                          disabled={autoAssigning || loadingInsightsModal}
                          className="px-3 py-2 text-xs font-medium rounded-lg bg-[#f57503] text-white hover:bg-[#e06a02] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Retente automatiquement d'affecter les promesses non attribuées via le mapping"
                        >
                          {autoAssigning ? 'Auto…' : 'Affectation auto'}
                        </button>

                        {autoAssignMsg && (
                          <span className="text-xs text-gray-700 bg-orange-50 border border-orange-100 px-2 py-1 rounded-lg">
                            {autoAssignMsg}
                          </span>
                        )}

                        {insightsAssignMsg && (
                          <span className="text-xs text-gray-700 bg-orange-50 border border-orange-100 px-2 py-1 rounded-lg">
                            {insightsAssignMsg}
                          </span>
                        )}
                      </div>
                    </div>

                    {PARTNERS.map((p) => {
                      const groups = nonAttributedByPartner?.[p.id] ?? [];
                      const total = groups.reduce((s, g) => s + g.revenue, 0);
                      if (!groups.length) return null;

                      return (
                        <div key={p.id} className="mb-6">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                              <h4 className="text-sm font-semibold text-gray-900">{p.label}</h4>
                              <span className="text-xs text-gray-400">({fmtEur(total)})</span>
                            </div>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Clé (mapping)</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Ville (réservation)</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Pays (réservation)</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Promesses</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Nb</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Raison</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Affecter</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {groups.map((g) => {
                                  const gid = groupIdForNonAttributed(g);
                                  const selected = assignSiteByGroupId[gid] ?? '';
                                  return (
                                    <tr key={gid} className="hover:bg-gray-50/50 transition-colors">
                                      <td className="px-3 py-3 text-gray-700">
                                        <div className="font-medium text-gray-900">{g.mappingKey}</div>
                                        <div className="text-xs text-gray-400 mt-0.5">
                                          {g.mappingKind === 'affiliateId' ? 'affiliateId' : 'productName'} · ex. {g.exampleDateStr}
                                        </div>
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {g.exampleReservationCity ? g.exampleReservationCity : <span className="text-gray-300">—</span>}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {g.exampleReservationCountry ? g.exampleReservationCountry : <span className="text-gray-300">—</span>}
                                      </td>
                                      <td className="px-3 py-3 text-right font-semibold text-gray-900">{fmtEur(g.revenue)}</td>
                                      <td className="px-3 py-3 text-right text-gray-600">{g.count}</td>
                                      <td className="px-3 py-3 text-gray-600">
                                        <div className="text-xs text-gray-600">{g.reason}</div>
                                      </td>
                                      <td className="px-3 py-3">
                                        <div className="flex items-center gap-2">
                                          <select
                                            value={selected}
                                            onChange={(e) => setAssignSiteByGroupId((prev) => ({ ...prev, [gid]: e.target.value }))}
                                            className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white max-w-[220px] outline-none"
                                          >
                                            <option value="">— Laisser non attribué —</option>
                                            {sites.map((s) => (
                                              <option key={s._id} value={s.shortName}>
                                                {s.shortName}
                                              </option>
                                            ))}
                                          </select>
                                          <button
                                            onClick={() => assignNonAttributedGroup(g)}
                                            disabled={!selected || assigningGroupId[gid]}
                                            className="px-3 py-2 text-xs font-medium rounded-lg bg-[#f57503] text-white hover:bg-[#e06a02] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                          >
                                            {assigningGroupId[gid] ? '...' : 'Affecter'}
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}

                    {PARTNERS.every((p) => (nonAttributedByPartner?.[p.id] ?? []).length === 0) && (
                      <div className="py-8 text-center text-gray-400 text-sm">
                        Aucune promesse non attribuée pour cette période (ou déjà affectée).
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

