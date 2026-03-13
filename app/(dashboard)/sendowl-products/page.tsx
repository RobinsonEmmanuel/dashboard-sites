'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, MagnifyingGlassIcon, CircleStackIcon } from '@heroicons/react/24/outline';
import type { SendowlProduct } from '@/lib/models/sendowl-product';

const SITE_CODES = [
  'ZZOE', 'ZV', 'ZR', 'ZE',
  'CL - EN', 'CL - FR', 'CL - DE', 'CL - IT', 'CL - ES', 'CL - NL',
  'NL - FR', 'NL - EN', 'NL - DE', 'NL - ES', 'NL - IT', 'NL - NL',
];

const SITE_CODE_TO_SHORTNAME: Record<string, string> = {
  'ZZOE': 'ZZ EN', 'ZV': 'ZZ FR', 'ZR': 'ZZ R', 'ZE': 'ZZ ES',
  'CL - EN': 'Corse', 'CL - FR': 'Corse', 'CL - DE': 'Corse', 'CL - IT': 'Corse', 'CL - ES': 'Corse', 'CL - NL': 'Corse',
  'NL - FR': 'Normandie', 'NL - EN': 'Normandie', 'NL - DE': 'Normandie', 'NL - ES': 'Normandie', 'NL - IT': 'Normandie', 'NL - NL': 'Normandie',
};

const EMPTY: Omit<SendowlProduct, '_id'> = { productId: '', productName: '', siteCode: 'ZV', siteName: 'ZZ FR', destination: '' };

export default function SendowlProductsPage() {
  const [products, setProducts] = useState<SendowlProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SendowlProduct | null>(null);
  const [form, setForm] = useState<Omit<SendowlProduct, '_id'>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterSite, setFilterSite] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/sendowl-products');
    const data = await res.json();
    setProducts(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setShowModal(true);
  };

  const openEdit = (p: SendowlProduct) => {
    setEditing(p);
    setForm({ productId: p.productId, productName: p.productName, siteCode: p.siteCode, siteName: p.siteName, destination: p.destination });
    setShowModal(true);
  };

  const handleSiteCodeChange = (code: string) => {
    setForm((f) => ({ ...f, siteCode: code, siteName: SITE_CODE_TO_SHORTNAME[code] ?? '' }));
  };

  const handleSave = async () => {
    if (!form.productName.trim() || !form.siteCode || !form.siteName.trim()) return;
    setSaving(true);
    if (editing) {
      await fetch(`/api/sendowl-products/${editing._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/sendowl-products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
    }
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/sendowl-products/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    load();
  };

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg('');
    const res = await fetch('/api/sendowl-products/seed', { method: 'POST' });
    const data = await res.json();
    setSeedMsg(data.message ?? 'Done');
    setSeeding(false);
    load();
  };

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.productName.toLowerCase().includes(q) || p.destination.toLowerCase().includes(q) || p.siteCode.toLowerCase().includes(q);
    const matchSite = !filterSite || p.siteName === filterSite;
    return matchSearch && matchSite;
  });

  const uniqueSites = [...new Set(products.map((p) => p.siteName))].sort();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Produits SendOwl</h1>
          <p className="text-sm text-gray-500 mt-0.5">Correspondance nom de produit → site pour l'import CSV</p>
        </div>
        <div className="flex items-center gap-3">
          {products.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              <CircleStackIcon className="w-4 h-4" />
              {seeding ? 'Import…' : 'Importer les 70+ produits'}
            </button>
          )}
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-[#f57503] text-white hover:bg-orange-600 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Ajouter
          </button>
        </div>
      </div>

      {seedMsg && (
        <div className="px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm border border-green-100">
          {seedMsg}
        </div>
      )}

      {/* Filtres */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un produit…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>
        <select
          value={filterSite}
          onChange={(e) => setFilterSite(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
        >
          <option value="">Tous les sites</option>
          {uniqueSites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-sm text-gray-400">{filtered.length} produit{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <CircleStackIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{products.length === 0 ? 'Aucun produit. Cliquez sur "Importer" pour charger les produits par défaut.' : 'Aucun résultat pour cette recherche.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Produit</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Code</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Site</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Destination</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">ID produit</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((p) => (
                  <tr key={String(p._id)} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900 max-w-xs truncate" title={p.productName}>
                      {p.productName}
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-mono">{p.siteCode}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{p.siteName}</td>
                    <td className="px-5 py-3 text-gray-500">{p.destination || '—'}</td>
                    <td className="px-5 py-3 text-gray-400 font-mono text-xs">{p.productId || '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(String(p._id))}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal ajout / édition */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Modifier le produit' : 'Nouveau produit'}</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom exact dans le CSV <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.productName}
                  onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
                  placeholder="Ex: Le guide du road trip – Corse (eBook) (x1)"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
                <p className="text-xs text-gray-400 mt-1">Doit correspondre exactement au contenu de la colonne "Item Name" dans le CSV SendOwl.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code site SendOwl <span className="text-red-500">*</span></label>
                <select
                  value={form.siteCode}
                  onChange={(e) => handleSiteCodeChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                >
                  {SITE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Site dashboard <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.siteName}
                  onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))}
                  placeholder="Ex: ZZ FR, Corse, Normandie"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destination (informatif)</label>
                <input
                  type="text"
                  value={form.destination}
                  onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
                  placeholder="Ex: Islande, Madere, Santorin"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ID produit SendOwl</label>
                <input
                  type="text"
                  value={form.productId}
                  onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                  placeholder="Ex: 78250283"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.productName.trim() || !form.siteName.trim()}
                className="px-5 py-2 rounded-xl text-sm font-medium bg-[#f57503] text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Supprimer ce produit ?</h3>
            <p className="text-sm text-gray-500 mb-5">Cette action est irréversible.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
