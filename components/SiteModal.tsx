'use client';

import { useState } from 'react';
import { parseResponseJson } from '@/lib/parse-response-json';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Site } from '@/lib/models/site';

interface Props {
  site: Site | null;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: Omit<Site, '_id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  shortName: '',
  ga4PropertyId: '',
  gscSiteUrl: '',
  gscType: 'domain',
  linkEvent: 'click',
  active: true,
  bookingAffiliateId: '',
  discoverCarsChan: '',
  gygCampaign: '',
  tiqetsCampaign: '',
};

export default function SiteModal({ site, onClose, onSaved }: Props) {
  const isEdit = !!site;
  const [form, setForm] = useState<Omit<Site, '_id' | 'createdAt' | 'updatedAt'>>(
    site
      ? {
          name: site.name,
          shortName: site.shortName,
          ga4PropertyId: site.ga4PropertyId,
          gscSiteUrl: site.gscSiteUrl,
          gscType: site.gscType,
          linkEvent: site.linkEvent,
          active: site.active,
          bookingAffiliateId: site.bookingAffiliateId ?? '',
          discoverCarsChan: site.discoverCarsChan ?? '',
          gygCampaign: site.gygCampaign ?? '',
          tiqetsCampaign: site.tiqetsCampaign ?? '',
        }
      : EMPTY
  );

  /* Événements réellement collectés par la propriété GA4. L'ingestion filtre sur un nom
   * EXACT : un nom qui ne correspond pas ne produit pas d'erreur, il produit zéro. On
   * propose donc la vérité de la propriété plutôt qu'une liste figée de deux valeurs. */
  const [evenements, setEvenements] = useState<Array<{ nom: string; evenements: number }> | null>(null);
  const [chargementEvts, setChargementEvts] = useState(false);
  const [erreurEvts, setErreurEvts] = useState<string | null>(null);

  const chargerEvenements = async () => {
    if (!form.ga4PropertyId.trim()) {
      setErreurEvts('Renseignez d\'abord le Property ID.');
      return;
    }
    setChargementEvts(true);
    setErreurEvts(null);
    try {
      const res = await fetch(`/api/ingest/ga4/events?propertyId=${encodeURIComponent(form.ga4PropertyId.trim())}&days=30`);
      const data = await parseResponseJson<{
        evenements?: Array<{ nom: string; evenements: number }>;
        candidats?: Array<{ nom: string; evenements: number }>;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const liste = data.evenements ?? [];
      setEvenements(liste);
      if (liste.length === 0) setErreurEvts('Aucun événement collecté sur 30 jours pour cette propriété.');
    } catch (e) {
      setErreurEvts(e instanceof Error ? e.message : String(e));
    } finally {
      setChargementEvts(false);
    }
  };

  const candidats = (evenements ?? []).filter((e) => /click|clic|exit|outbound|affil|sortant/i.test(e.nom));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (field: keyof typeof form, value: string | boolean) =>
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Active automatiquement le site dès qu'un GA4 Property ID est renseigné
      if (field === 'ga4PropertyId') {
        next.active = String(value).trim().length > 0;
      }
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const url = isEdit ? `/api/sites/${site._id}` : '/api/sites';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Erreur lors de la sauvegarde');
        return;
      }
      onSaved();
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#f57503] focus:border-transparent outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Modifier le site' : 'Ajouter un site'}
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          {/* Infos générales */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Informations</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom complet <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Normandie Lovers" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom court <span className="text-red-500">*</span></label>
                <input value={form.shortName} onChange={(e) => set('shortName', e.target.value)} required placeholder="Normandie" className={inputCls} />
              </div>
            </div>
          </div>

          {/* GA4 */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Google Analytics 4</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Property ID <span className="text-red-500">*</span></label>
                <input value={form.ga4PropertyId} onChange={(e) => set('ga4PropertyId', e.target.value)} required placeholder="334290963" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    Événement clic sortant <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { void chargerEvenements(); }}
                    disabled={chargementEvts}
                    className="text-xs font-medium text-[#f57503] hover:underline disabled:opacity-40"
                  >
                    {chargementEvts ? 'Lecture…' : 'Lire les événements GA4'}
                  </button>
                </div>
                <input
                  list="ga4-evenements"
                  value={form.linkEvent}
                  onChange={(e) => set('linkEvent', e.target.value)}
                  required
                  placeholder="clic_exit_link"
                  className={`${inputCls} font-mono`}
                />
                <datalist id="ga4-evenements">
                  {(evenements ?? []).map((e) => (
                    <option key={e.nom} value={e.nom}>{`${e.evenements} événements sur 30 j`}</option>
                  ))}
                </datalist>
                {erreurEvts && <p className="text-xs text-red-600 mt-1">{erreurEvts}</p>}
                {candidats.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Candidats dans cette propriété :{' '}
                    {candidats.map((c, i) => (
                      <span key={c.nom}>
                        {i > 0 && ', '}
                        <button
                          type="button"
                          onClick={() => set('linkEvent', c.nom)}
                          className="font-mono text-[#f57503] hover:underline"
                        >
                          {c.nom}
                        </button>
                        {` (${c.evenements})`}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* GSC */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Google Search Console</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">URL du site <span className="text-red-500">*</span></label>
                <input value={form.gscSiteUrl} onChange={(e) => set('gscSiteUrl', e.target.value)} required placeholder="normandielovers.fr" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Type <span className="text-red-500">*</span></label>
                <select value={form.gscType} onChange={(e) => set('gscType', e.target.value as 'url' | 'domain')} className={`${inputCls} bg-white`}>
                  <option value="domain">domain</option>
                  <option value="url">url</option>
                </select>
              </div>
            </div>
          </div>

          {/* Affiliation */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Codes affiliation</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Booking Affiliate ID</label>
                <input value={form.bookingAffiliateId ?? ''} onChange={(e) => set('bookingAffiliateId', e.target.value)} placeholder="2281719" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">DiscoverCars chan=</label>
                <input value={form.discoverCarsChan ?? ''} onChange={(e) => set('discoverCarsChan', e.target.value)} placeholder="NL" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">GetYourGuide cmp=</label>
                <input value={form.gygCampaign ?? ''} onChange={(e) => set('gygCampaign', e.target.value)} placeholder="NL" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tiqets tq_campaign=</label>
                <input value={form.tiqetsCampaign ?? ''} onChange={(e) => set('tiqetsCampaign', e.target.value)} placeholder="NL" className={`${inputCls} font-mono`} />
              </div>
            </div>
          </div>

          {/* Statut */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={form.active}
              onClick={() => set('active', !form.active)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.active ? 'bg-[#f57503]' : 'bg-gray-200'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${form.active ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-gray-700">Site actif</span>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-[#f57503] rounded-lg hover:bg-[#e06a02] transition-colors disabled:opacity-50">
              {loading ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
