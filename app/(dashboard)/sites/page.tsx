'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';
import type { Site } from '@/lib/models/site';
import SiteModal from '@/components/SiteModal';

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSites = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sites');
      const data = await res.json();
      setSites(Array.isArray(data) ? data : []);
    } catch {
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMessage('');
    try {
      const res = await fetch('/api/sites/seed', { method: 'POST' });
      const data = await res.json();
      setSeedMessage(data.message);
      if (!data.skipped) fetchSites();
    } catch {
      setSeedMessage('Erreur lors du seed.');
    } finally {
      setSeeding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce site ?')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/sites/${id}`, { method: 'DELETE' });
      fetchSites();
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (site: Site) => {
    await fetch(`/api/sites/${site._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...site, active: !site.active }),
    });
    fetchSites();
  };

  const openAdd = () => { setEditingSite(null); setModalOpen(true); };
  const openEdit = (site: Site) => { setEditingSite(site); setModalOpen(true); };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestion des sites</h1>
          <p className="text-gray-500 mt-1">
            {sites.length} site{sites.length !== 1 ? 's' : ''} configuré{sites.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {sites.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <CircleStackIcon className="w-4 h-4" />
              {seeding ? 'Import…' : 'Importer les 14 sites'}
            </button>
          )}
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#f57503] rounded-lg hover:bg-[#e06a02] transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Ajouter un site
          </button>
        </div>
      </div>

      {seedMessage && (
        <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm">
          {seedMessage}
        </div>
      )}

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <ArrowPathIcon className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CircleStackIcon className="w-10 h-10 text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">Aucun site configuré</p>
            <p className="text-sm text-gray-400 mt-1">
              Cliquez sur &quot;Importer les 14 sites&quot; pour charger les sites par défaut.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Site</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">GA4 Property ID</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">GSC URL</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Événement lien</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sites.map((site) => (
                <tr key={site._id as string} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-medium text-gray-900">{site.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{site.shortName}</div>
                  </td>
                  <td className="px-5 py-4">
                    <code className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                      {site.ga4PropertyId}
                    </code>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                          site.gscType === 'domain'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {site.gscType}
                      </span>
                      <span className="text-gray-600 text-xs truncate max-w-40">{site.gscSiteUrl}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <code className="text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded">
                      {site.linkEvent}
                    </code>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button
                      onClick={() => handleToggleActive(site)}
                      title={site.active ? 'Désactiver' : 'Activer'}
                      className="inline-flex items-center justify-center"
                    >
                      {site.active ? (
                        <CheckCircleIcon className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircleIcon className="w-5 h-5 text-gray-300" />
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(site)}
                        className="p-1.5 text-gray-400 hover:text-[#f57503] hover:bg-orange-50 rounded-lg transition-colors"
                        title="Modifier"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(site._id as string)}
                        disabled={deletingId === (site._id as string)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Supprimer"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <SiteModal
          site={editingSite}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); fetchSites(); }}
        />
      )}
    </div>
  );
}
