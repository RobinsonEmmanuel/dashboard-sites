'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { parseResponseJson } from '@/lib/parse-response-json';
import type { ContexteMetier } from '@/lib/trajectory/context';

/**
 * Saisie du contexte métier.
 *
 * Le seul bloc du dossier qui ne peut être ni calculé ni recherché : il porte
 * l'intention. D'où le parti pris d'affichage — le panneau s'ouvre de lui-même tant
 * qu'il manque des champs, et nomme lesquels, plutôt que de laisser croire que
 * l'analyse est calibrée alors qu'elle ne l'est pas.
 */

interface Reponse {
  contexte: ContexteMetier;
  champs_non_renseignes: string[];
  modifie_le: string | null;
}

const VIDE: ContexteMetier = {
  horizon: '',
  objectifs: [],
  sites_en_investissement: [],
  sites_en_recolte: [],
  contraintes: [],
  decisions_ouvertes: [],
  evenements_a_connaitre: [],
};

const LIBELLE_CHAMP: Record<string, string> = {
  horizon: 'horizon',
  objectifs: 'objectifs',
  contraintes: 'contraintes',
  decisions_ouvertes: 'décisions ouvertes',
  'arbitrage investissement / récolte': 'arbitrage investissement / récolte',
};

const enLignes = (v: string[]) => v.join('\n');
const depuisLignes = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);

export default function TrajectoryContext({ onSaved }: { onSaved?: () => void }) {
  const [contexte, setContexte] = useState<ContexteMetier>(VIDE);
  const [manquants, setManquants] = useState<string[]>([]);
  const [modifieLe, setModifieLe] = useState<string | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);

  const charger = useCallback(async () => {
    try {
      const [ctxRes, sitesRes] = await Promise.all([
        fetch('/api/trajectory/context'),
        fetch('/api/sites'),
      ]);
      const ctx = await parseResponseJson<Reponse & { error?: string }>(ctxRes);
      if (!ctxRes.ok) throw new Error(ctx.error || `HTTP ${ctxRes.status}`);
      setContexte({ ...VIDE, ...ctx.contexte });
      setManquants(ctx.champs_non_renseignes);
      setModifieLe(ctx.modifie_le);
      // Tant qu'il manque quelque chose, le panneau s'ouvre : c'est le point de départ.
      setOuvert(ctx.champs_non_renseignes.length > 0);

      if (sitesRes.ok) {
        const liste = await parseResponseJson<Array<{ shortName: string; active: boolean }>>(sitesRes);
        setSites(liste.filter((s) => s.active).map((s) => s.shortName).sort());
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void charger(); }, [charger]);

  const enregistrer = async () => {
    setEnregistrement(true);
    setErreur(null);
    setSucces(false);
    try {
      const res = await fetch('/api/trajectory/context', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contexte),
      });
      const data = await parseResponseJson<Reponse & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setContexte({ ...VIDE, ...data.contexte });
      setManquants(data.champs_non_renseignes);
      setModifieLe(data.modifie_le);
      setSucces(true);
      onSaved?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnregistrement(false);
    }
  };

  const basculerSite = (champ: 'sites_en_investissement' | 'sites_en_recolte', site: string) => {
    setContexte((c) => {
      const dedans = c[champ].includes(site);
      // Un site ne peut pas être à la fois en investissement et en récolte.
      const autre = champ === 'sites_en_investissement' ? 'sites_en_recolte' : 'sites_en_investissement';
      return {
        ...c,
        [champ]: dedans ? c[champ].filter((s) => s !== site) : [...c[champ], site],
        [autre]: dedans ? c[autre] : c[autre].filter((s) => s !== site),
      };
    });
    setSucces(false);
  };

  const zone = (
    label: string,
    aide: string,
    champ: 'objectifs' | 'contraintes' | 'decisions_ouvertes' | 'evenements_a_connaitre',
    lignes = 3,
  ) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</label>
      <p className="text-xs text-gray-400 mt-0.5">{aide}</p>
      <textarea
        rows={lignes}
        value={enLignes(contexte[champ])}
        onChange={(e) => { setContexte((c) => ({ ...c, [champ]: depuisLignes(e.target.value) })); setSucces(false); }}
        placeholder="Une ligne par élément"
        className="mt-2 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#191E55] outline-none resize-y"
      />
    </div>
  );

  const chips = (label: string, aide: string, champ: 'sites_en_investissement' | 'sites_en_recolte') => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</label>
      <p className="text-xs text-gray-400 mt-0.5">{aide}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sites.map((s) => {
          const actif = contexte[champ].includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => basculerSite(champ, s)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                actif
                  ? 'bg-[#191E55] text-white border-[#191E55]'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s}
            </button>
          );
        })}
        {sites.length === 0 && <span className="text-xs text-gray-400">Aucun site actif.</span>}
      </div>
    </div>
  );

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Contexte métier</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {manquants.length > 0 ? (
              <span className="text-amber-700">
                À compléter : {manquants.map((m) => LIBELLE_CHAMP[m] ?? m).join(', ')}. Sans ces
                éléments, l&apos;analyse ne suppose rien et reste générique.
              </span>
            ) : modifieLe ? (
              `Complet — dernière modification le ${new Date(modifieLe).toLocaleString('fr-FR')}`
            ) : (
              'Complet'
            )}
          </p>
        </div>
        <button
          onClick={() => setOuvert((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#f57503] hover:underline whitespace-nowrap"
        >
          <PencilSquareIcon className="w-4 h-4" />
          {ouvert ? 'Masquer' : 'Modifier'}
        </button>
      </div>

      {ouvert && (
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Horizon</label>
            <p className="text-xs text-gray-400 mt-0.5">Où tu veux être, et quand. Une phrase.</p>
            <textarea
              rows={2}
              value={contexte.horizon}
              onChange={(e) => { setContexte((c) => ({ ...c, horizon: e.target.value })); setSucces(false); }}
              placeholder="Ex. doubler le revenu d'affiliation à 24 mois sans augmenter le rythme de production"
              className="mt-2 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#191E55] outline-none resize-y"
            />
          </div>

          {zone('Objectifs', 'Chiffrés autant que possible, pour l\'année en cours.', 'objectifs')}

          <div className="grid md:grid-cols-2 gap-5">
            {chips('Sites en investissement', 'On y met du temps, on n\'attend pas encore de revenu.', 'sites_en_investissement')}
            {chips('Sites en récolte', 'Matures, on en attend du revenu maintenant.', 'sites_en_recolte')}
          </div>

          {zone('Contraintes', 'Temps de rédaction disponible, budget, dépendances.', 'contraintes')}
          {zone('Décisions ouvertes', 'Les questions que l\'analyse doit aider à trancher. Chacune sera adressée explicitement.', 'decisions_ouvertes')}
          {zone(
            'Événements à connaître',
            'Ce qui explique un chiffre et n\'est pas dans la base : refonte, changement de thème, pénalité, campagne exceptionnelle.',
            'evenements_a_connaitre',
          )}

          {erreur && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-sm text-red-700">{erreur}</div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => { void enregistrer(); }}
              disabled={enregistrement}
              className="px-4 py-2 text-sm font-medium text-white bg-[#191E55] rounded-lg hover:bg-[#131845] transition-colors disabled:opacity-40"
            >
              {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {succes && (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                <CheckIcon className="w-4 h-4" /> Enregistré
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
