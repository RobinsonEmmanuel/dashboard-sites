'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowPathIcon,
  FunnelIcon,
  ArrowDownTrayIcon,
  LightBulbIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GscRow {
  _id: string;
  siteId: string;
  siteName: string;
  shortName: string;
  page?: string;
  query?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Site { _id: string; name: string; shortName: string; }

type TabId = 'pages' | 'queries' | 'opportunities';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

function CtrBar({ ctr }: { ctr: number }) {
  const pct = Math.min(ctr * 100, 100);
  const color = pct >= 5 ? 'bg-green-500' : pct >= 2 ? 'bg-orange-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600">{(ctr * 100).toFixed(2)}%</span>
    </div>
  );
}

function PositionBadge({ pos }: { pos: number }) {
  const color = pos <= 3 ? 'bg-green-100 text-green-700' : pos <= 10 ? 'bg-blue-100 text-blue-700' : pos <= 20 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-flex items-center justify-center w-10 h-6 text-xs font-semibold rounded-md ${color}`}>
      {pos.toFixed(1)}
    </span>
  );
}

function truncateUrl(url: string, max = 60): string {
  if (!url) return '';
  const clean = url.replace(/^https?:\/\//, '');
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// ─── Table générique pages/requêtes ──────────────────────────────────────────

function GscTable({ rows, type, loading }: { rows: GscRow[]; type: 'page' | 'query'; loading: boolean }) {
  const keyField = type === 'page' ? 'page' : 'query';

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <ArrowPathIcon className="w-5 h-5 text-gray-300 animate-spin" />
    </div>
  );

  if (!rows.length) return (
    <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
      Aucune donnée — lancez une synchronisation GSC d'abord.
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">#</th>
            {type === 'page' && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Site</th>}
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{type === 'page' ? 'Page' : 'Requête'}</th>
            {type === 'query' && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Site</th>}
            <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Clics</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Impressions</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">CTR</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">Position</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row, i) => (
            <tr key={row._id ?? i} className="hover:bg-gray-50/50 transition-colors">
              <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
              {type === 'page' && (
                <td className="px-4 py-3">
                  <span className="text-[10px] font-semibold bg-[#191E55]/10 text-[#191E55] px-1.5 py-0.5 rounded">{row.shortName}</span>
                </td>
              )}
              <td className="px-4 py-3 max-w-sm">
                <span className="text-gray-700 text-xs font-mono truncate block" title={row[keyField]}>
                  {type === 'page' ? truncateUrl(row.page ?? '', 70) : row.query}
                </span>
              </td>
              {type === 'query' && (
                <td className="px-4 py-3">
                  <span className="text-[10px] font-semibold bg-[#191E55]/10 text-[#191E55] px-1.5 py-0.5 rounded">{row.shortName}</span>
                </td>
              )}
              <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmtNum(row.clicks)}</td>
              <td className="px-4 py-3 text-right text-gray-600">{fmtNum(row.impressions)}</td>
              <td className="px-4 py-3"><CtrBar ctr={row.ctr} /></td>
              <td className="px-4 py-3 text-center"><PositionBadge pos={row.position} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Table opportunités ───────────────────────────────────────────────────────

function OpportunitiesTable({ rows, loading }: { rows: GscRow[]; loading: boolean }) {
  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <ArrowPathIcon className="w-5 h-5 text-gray-300 animate-spin" />
    </div>
  );

  if (!rows.length) return (
    <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
      Aucune opportunité détectée (impressions ≥ 500, CTR ≤ 3%).
    </div>
  );

  return (
    <div>
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-4">
        Ces pages ont un fort volume d'impressions mais un CTR faible — elles sont bien positionnées mais le titre/meta description n'incite pas au clic.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">#</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Site</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Page</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Impressions</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">CTR actuel</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">Position</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Gain potentiel</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => {
              // Gain potentiel : si CTR passe à 5%, combien de clics supplémentaires ?
              const potentialClicks = Math.round(row.impressions * 0.05) - row.clicks;
              return (
                <tr key={row._id ?? i} className="hover:bg-amber-50/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-semibold bg-[#191E55]/10 text-[#191E55] px-1.5 py-0.5 rounded">{row.shortName}</span>
                  </td>
                  <td className="px-4 py-3 max-w-sm">
                    <span className="text-gray-700 text-xs font-mono truncate block" title={row.page}>
                      {truncateUrl(row.page ?? '', 70)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmtNum(row.impressions)}</td>
                  <td className="px-4 py-3"><CtrBar ctr={row.ctr} /></td>
                  <td className="px-4 py-3 text-center"><PositionBadge pos={row.position} /></td>
                  <td className="px-4 py-3 text-right">
                    {potentialClicks > 0 ? (
                      <span className="text-green-600 font-semibold text-xs">+{fmtNum(potentialClicks)} clics</span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'pages', label: 'Top pages', icon: DocumentTextIcon },
  { id: 'queries', label: 'Top requêtes', icon: MagnifyingGlassIcon },
  { id: 'opportunities', label: 'Opportunités SEO', icon: LightBulbIcon },
];

export default function SeoPage() {
  const [tab, setTab] = useState<TabId>('pages');
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [pages, setPages] = useState<GscRow[]>([]);
  const [queries, setQueries] = useState<GscRow[]>([]);
  const [opportunities, setOpportunities] = useState<GscRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/sites').then((r) => r.json()).then((d) => setSites(Array.isArray(d) ? d : []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = siteId ? `?siteId=${siteId}` : '';
    try {
      const [pRes, qRes, oRes] = await Promise.all([
        fetch(`/api/seo/pages${params}`),
        fetch(`/api/seo/queries${params}`),
        fetch(`/api/seo/opportunities${params}`),
      ]);
      const [p, q, o] = await Promise.all([pRes.json(), qRes.json(), oRes.json()]);
      setPages(Array.isArray(p) ? p : []);
      setQueries(Array.isArray(q) ? q : []);
      setOpportunities(Array.isArray(o) ? o : []);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    const data = tab === 'pages' ? pages : tab === 'queries' ? queries : opportunities;
    const keyField = tab === 'queries' ? 'query' : 'page';
    const headers = ['Site', tab === 'queries' ? 'Requête' : 'Page', 'Clics', 'Impressions', 'CTR', 'Position'];
    const rows = data.map((r) => [
      r.siteName,
      r[keyField] ?? '',
      r.clicks,
      r.impressions,
      (r.ctr * 100).toFixed(2) + '%',
      r.position.toFixed(1),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seo-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = { pages: pages.length, queries: queries.length, opportunities: opportunities.length };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance SEO</h1>
          <p className="text-gray-500 mt-1 text-sm">Données Google Search Console</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
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

      {/* Filtre site */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 w-fit mb-6">
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

      {/* Onglets */}
      <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-[#191E55] text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
              tab === id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {counts[id]}
            </span>
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {tab === 'pages' && <GscTable rows={pages} type="page" loading={loading} />}
        {tab === 'queries' && <GscTable rows={queries} type="query" loading={loading} />}
        {tab === 'opportunities' && <OpportunitiesTable rows={opportunities} loading={loading} />}
      </div>
    </div>
  );
}
