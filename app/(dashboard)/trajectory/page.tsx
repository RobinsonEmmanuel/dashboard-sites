'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  ExclamationTriangleIcon,
  GlobeAmericasIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { parseResponseJson } from '@/lib/parse-response-json';
import { waitForQueueJob } from '@/lib/ingest-poll';
import TrajectoryContext from '@/components/TrajectoryContext';
import { moisLisible } from '@/lib/trajectory/months';
import type {
  AnalyseTrajectoireDoc,
  AxeConstat,
  Constat,
  NiveauConfiance,
} from '@/lib/trajectory/types';
import type { ResumeAnalyse } from '@/lib/trajectory/store';
import type { EvenementVeilleDoc } from '@/lib/trajectory/veille-store';

type ListeReponse = { derniere: { id: string } | null; historique: ResumeAnalyse[] };
type VeilleReponse = { derniere_veille: string | null; evenements: EvenementVeilleDoc[] };

const LIBELLE_CATEGORIE: Record<string, string> = {
  google_algorithme: 'Google — algorithme',
  ia_generative: 'IA générative',
  conjoncture_touristique: 'Conjoncture touristique',
  geopolitique: 'Géopolitique',
  meteo_climat: 'Météo et climat',
  reglementation: 'Réglementation',
  concurrence_plateformes: 'Plateformes',
};

const COULEUR_APPLICABILITE: Record<string, string> = {
  directe: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  indirecte: 'bg-blue-50 text-blue-700 border-blue-200',
  non_transposable: 'bg-gray-100 text-gray-500 border-gray-200',
};

const LIBELLE_APPLICABILITE: Record<string, string> = {
  directe: 'Applicable à nos sites',
  indirecte: 'Indirect',
  non_transposable: 'Non transposable',
};

const LIBELLE_AXE: Record<AxeConstat, string> = {
  revenu: 'Revenu',
  trafic: 'Trafic',
  seo: 'SEO',
  conversion: 'Conversion',
  mix_partenaires: 'Mix partenaires',
  risque: 'Risque',
  saisonnalite: 'Saisonnalité',
  production_editoriale: 'Production éditoriale',
  fiabilite_donnees: 'Fiabilité des données',
};

const ORDRE_AXES: AxeConstat[] = [
  'revenu', 'conversion', 'trafic', 'seo', 'production_editoriale',
  'mix_partenaires', 'risque', 'saisonnalite', 'fiabilite_donnees',
];

const COULEUR_CONFIANCE: Record<NiveauConfiance, string> = {
  robuste: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  a_confirmer: 'bg-amber-50 text-amber-700 border-amber-200',
  hypothese: 'bg-gray-100 text-gray-600 border-gray-200',
};

const LIBELLE_CONFIANCE: Record<NiveauConfiance, string> = {
  robuste: 'Robuste',
  a_confirmer: 'À confirmer',
  hypothese: 'Hypothèse',
};

const COULEUR_PREUVE: Record<string, string> = {
  correctif_demontre: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  optimisation_probable: 'bg-blue-50 text-blue-700 border-blue-200',
  experimentation: 'bg-amber-50 text-amber-700 border-amber-200',
  structurel: 'bg-violet-50 text-violet-700 border-violet-200',
};

const LIBELLE_PREUVE: Record<string, string> = {
  correctif_demontre: 'Correctif démontré',
  optimisation_probable: 'Optimisation probable',
  experimentation: 'Expérimentation',
  structurel: 'Structurel',
};

const COULEUR_STATUT: Record<string, string> = {
  porte: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sans_effet: 'bg-red-50 text-red-700 border-red-200',
  non_mis_en_oeuvre: 'bg-gray-100 text-gray-600 border-gray-200',
  indeterminable: 'bg-amber-50 text-amber-700 border-amber-200',
};

const LIBELLE_STATUT: Record<string, string> = {
  porte: 'A porté',
  sans_effet: 'Sans effet',
  non_mis_en_oeuvre: 'Non mis en œuvre',
  indeterminable: 'Indéterminable',
};

const eur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const nombre = (n: number) => new Intl.NumberFormat('fr-FR').format(n);
const pct = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('fr-FR')} %`);

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function Section({
  titre, sous, children, action,
}: { titre: string; sous?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{titre}</h2>
          {sous && <p className="text-xs text-gray-400 mt-0.5">{sous}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function TrajectoryPage() {
  const [liste, setListe] = useState<ListeReponse | null>(null);
  const [doc, setDoc] = useState<AnalyseTrajectoireDoc | null>(null);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(false);
  const [etape, setEtape] = useState<string>('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [dossierOuvert, setDossierOuvert] = useState(false);
  const [veille, setVeille] = useState<VeilleReponse | null>(null);
  const [veilleEnCours, setVeilleEnCours] = useState(false);

  const chargerDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/trajectory/analyses/${id}`);
    const data = await parseResponseJson<AnalyseTrajectoireDoc & { error?: string }>(res);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setDoc(data);
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const res = await fetch('/api/trajectory/analyses');
      const data = await parseResponseJson<ListeReponse & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setListe(data);
      if (data.derniere?.id) await chargerDetail(data.derniere.id);
      else setDoc(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setChargement(false);
    }
  }, [chargerDetail]);

  const chargerVeille = useCallback(async () => {
    try {
      const res = await fetch('/api/veille');
      const data = await parseResponseJson<VeilleReponse & { error?: string }>(res);
      if (res.ok) setVeille(data);
    } catch {
      /* La veille est un complément : son absence ne doit pas masquer l'analyse. */
    }
  }, []);

  useEffect(() => { void charger(); void chargerVeille(); }, [charger, chargerVeille]);

  const basculerEvenement = async (id: string, retenu: boolean) => {
    setVeille((v) => v && {
      ...v,
      evenements: v.evenements.map((e) => (String(e._id) === id ? { ...e, retenu } : e)),
    });
    await fetch(`/api/veille/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retenu }),
    }).catch(() => { void chargerVeille(); });
  };

  const relancerVeille = async () => {
    setVeilleEnCours(true);
    setErreur(null);
    try {
      const res = await fetch('/api/veille', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await parseResponseJson<{ queued?: boolean; jobId?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.queued && data.jobId) {
        await waitForQueueJob(String(data.jobId), { timeoutMs: 15 * 60 * 1000 });
      }
      await chargerVeille();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setVeilleEnCours(false);
    }
  };

  const lancer = async () => {
    setEnCours(true);
    setErreur(null);
    setEtape('Construction du dossier…');
    try {
      const res = await fetch('/api/trajectory/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await parseResponseJson<{ queued?: boolean; jobId?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      if (data.queued && data.jobId) {
        setEtape('Analyse en cours sur le worker (2 à 4 min)…');
        await waitForQueueJob(String(data.jobId), { timeoutMs: 20 * 60 * 1000 });
      }
      setEtape('Chargement du résultat…');
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
      setEtape('');
    }
  };

  const analyse = doc?.analyse;
  const redaction = doc?.redaction;
  const dossier = doc?.dossier;

  const constatsParAxe = ORDRE_AXES
    .map((axe) => ({ axe, items: (analyse?.constats ?? []).filter((c) => c.axe === axe) }))
    .filter((g) => g.items.length > 0);

  const scenarios = (horizon: '3_mois' | '12_mois') =>
    (analyse?.trajectoire ?? []).filter((s) => s.horizon === horizon);

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trajectoire</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Analyse d&apos;aide à la décision sur la base des chiffres du dashboard. Tous les
            chiffres cités viennent du dossier ci-dessous — le modèle n&apos;en calcule aucun.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {liste && liste.historique.length > 1 && (
            <select
              value={doc ? String(doc._id ?? '') : ''}
              onChange={(e) => { void chargerDetail(e.target.value); }}
              className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-[#f57503] outline-none"
            >
              {liste.historique.map((h) => (
                <option key={h.id} value={h.id}>
                  {new Date(h.createdAt).toLocaleDateString('fr-FR')} — {moisLisible(h.dernier_mois_complet)}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => { void lancer(); }}
            disabled={enCours}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#f57503] rounded-lg hover:bg-[#e06a02] transition-colors disabled:opacity-40"
          >
            <SparklesIcon className="w-4 h-4" />
            {enCours ? 'Analyse en cours…' : 'Lancer une analyse'}
          </button>
          <button
            onClick={() => { void charger(); }}
            disabled={chargement || enCours}
            title="Recharger"
            className="p-2 text-gray-500 hover:text-[#f57503] hover:bg-orange-50 rounded-lg transition-colors disabled:opacity-40"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {etape && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-3 text-sm text-blue-800">
          {etape}
        </div>
      )}
      {erreur && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-3 text-sm text-red-700">
          {erreur}
        </div>
      )}

      <TrajectoryContext />

      {chargement && !doc && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center text-gray-400 text-sm">
          Chargement…
        </div>
      )}

      {!chargement && !doc && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
          <ArrowTrendingUpIcon className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="mt-3 text-sm font-medium text-gray-900">Aucune analyse pour le moment</p>
          <p className="mt-1 text-sm text-gray-500 max-w-lg mx-auto">
            Renseignez d&apos;abord le contexte métier ci-dessus — objectifs, arbitrage
            investissement / récolte, décisions à trancher. C&apos;est le seul bloc que ni le
            calcul ni la recherche web ne peuvent produire, et sans lui les recommandations
            restent génériques.
          </p>
        </div>
      )}

      {doc && analyse && redaction && dossier && (
        <>
          {/* Cadre de lecture */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-gray-500">
                Analyse du{' '}
                <strong className="text-gray-900">
                  {new Date(doc.createdAt).toLocaleString('fr-FR')}
                </strong>
              </span>
              <span className="text-gray-500">
                Tendances arrêtées à{' '}
                <strong className="text-gray-900">{moisLisible(doc.dernier_mois_complet)}</strong>
              </span>
              <span className="text-gray-400 text-xs ml-auto">
                {doc.modele} · dossier {doc.dossierHash}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
              <div>
                <p className="text-xs text-gray-400">Promesses 12 mois</p>
                <p className="text-lg font-semibold text-gray-900">{eur(dossier.comparables.rolling12.promesses)}</p>
                <p className="text-xs text-gray-500">{pct(dossier.comparables.evolutions_pct.rolling12_vs_n1.promesses)} vs N-1</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Sessions 12 mois</p>
                <p className="text-lg font-semibold text-gray-900">{nombre(dossier.comparables.rolling12.sessions)}</p>
                <p className="text-xs text-gray-500">{pct(dossier.comparables.evolutions_pct.rolling12_vs_n1.sessions)} vs N-1</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">RPM</p>
                <p className="text-lg font-semibold text-gray-900">
                  {dossier.comparables.rolling12.rpm !== null ? `${dossier.comparables.rolling12.rpm} €` : '—'}
                </p>
                <p className="text-xs text-gray-500">promesses / 1 000 sessions</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Carnet Booking à venir</p>
                <p className="text-lg font-semibold text-gray-900">{eur(dossier.carnet.total)}</p>
                <p className="text-xs text-gray-500">{pct(dossier.carnet.evolution_pct)} vs N-1</p>
              </div>
            </div>

            {dossier.fiabilite.avertissements.length > 0 && (
              <details className="pt-1">
                <summary className="cursor-pointer text-xs font-medium text-amber-700 flex items-center gap-1.5">
                  <ExclamationTriangleIcon className="w-4 h-4" />
                  {dossier.fiabilite.avertissements.length} précaution(s) de lecture
                </summary>
                <ul className="mt-2 space-y-1.5 list-disc list-inside text-xs text-gray-600">
                  {dossier.fiabilite.avertissements.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </details>
            )}
          </div>

          {/* Résumé exécutif */}
          <Section titre="Résumé" sous={redaction.resume_executif.niveau_confiance}>
            <div className="px-6 py-5 space-y-5">
              <p className="text-sm text-gray-700 leading-relaxed">{redaction.narratif_intro}</p>
              <div className="grid md:grid-cols-3 gap-5">
                {([
                  ['Enseignements', redaction.resume_executif.enseignements, 'text-emerald-700'],
                  ['Risques', redaction.resume_executif.risques, 'text-red-700'],
                  ['Priorités', redaction.resume_executif.priorites, 'text-[#f57503]'],
                ] as const).map(([titre, items, couleur]) => (
                  <div key={titre}>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${couleur}`}>{titre}</p>
                    <ul className="mt-2 space-y-2">
                      {items.map((it, i) => (
                        <li key={i} className="text-sm text-gray-700 leading-snug pl-3 border-l-2 border-gray-100">
                          {it}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* Scénarios */}
          <Section
            titre="Trajectoire"
            sous="Promesses attendues sur l'horizon. Le 3 mois s'appuie sur le carnet et la saisonnalité, le 12 mois sur la tendance année contre année."
          >
            <div className="px-6 py-5 grid md:grid-cols-2 gap-6">
              {(['3_mois', '12_mois'] as const).map((horizon) => (
                <div key={horizon}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {horizon === '3_mois' ? 'À 3 mois' : 'À 12 mois'}
                  </p>
                  <div className="mt-3 space-y-3">
                    {scenarios(horizon).map((s, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex items-baseline justify-between gap-3">
                          <Badge className={
                            s.scenario === 'haut' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : s.scenario === 'bas' ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-gray-100 text-gray-700 border-gray-200'
                          }>
                            {s.scenario === 'central' ? 'Central' : s.scenario === 'haut' ? 'Haut' : 'Bas'}
                          </Badge>
                          <p className="text-sm font-semibold text-gray-900">
                            {eur(s.promesses_attendues_min)} – {eur(s.promesses_attendues_max)}
                          </p>
                        </div>
                        <ul className="mt-2 space-y-1 list-disc list-inside text-xs text-gray-600">
                          {s.hypotheses.map((h, j) => <li key={j}>{h}</li>)}
                        </ul>
                        <p className="mt-2 text-xs text-gray-500">
                          <span className="font-medium text-gray-600">Invalidé si :</span> {s.ce_qui_invaliderait}
                        </p>
                      </div>
                    ))}
                    {scenarios(horizon).length === 0 && (
                      <p className="text-sm text-gray-400">Aucun scénario produit.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Constats */}
          <Section titre="Constats" sous={`${analyse.constats.length} constats, regroupés par axe`}>
            <div className="divide-y divide-gray-50">
              {constatsParAxe.map(({ axe, items }) => (
                <div key={axe} className="px-6 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {LIBELLE_AXE[axe]}
                  </p>
                  <div className="mt-3 space-y-3">
                    {items.map((c: Constat, i) => (
                      <div key={i} className="flex gap-3">
                        <span
                          className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                            c.sens === 'favorable' ? 'bg-emerald-500'
                              : c.sens === 'defavorable' ? 'bg-red-500' : 'bg-gray-300'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm text-gray-900">{c.constat}</p>
                            <Badge className={COULEUR_CONFIANCE[c.niveau_confiance]}>
                              {LIBELLE_CONFIANCE[c.niveau_confiance]}
                            </Badge>
                            <Badge className="bg-gray-50 text-gray-500 border-gray-200">{c.cible}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">{c.preuve}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Plan d'action */}
          <Section titre="Plan d'action" sous="Trié par impact décroissant puis effort croissant">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Action', 'Nature', 'Effort', 'Impact', 'Indicateur de succès'].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...analyse.actions]
                    .sort((a, b) => {
                      const poids = { faible: 1, moyen: 2, eleve: 3 } as const;
                      return poids[b.impact] - poids[a.impact] || poids[a.effort] - poids[b.effort];
                    })
                    .map((a, i) => (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors align-top">
                        <td className="px-5 py-4 max-w-md">
                          <p className="text-gray-900">{a.action}</p>
                          <p className="mt-1 text-xs text-gray-400">{a.constat_origine}</p>
                        </td>
                        <td className="px-5 py-4">
                          <Badge className={COULEUR_PREUVE[a.niveau_preuve] ?? ''}>
                            {LIBELLE_PREUVE[a.niveau_preuve] ?? a.niveau_preuve}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 capitalize text-gray-600">{a.effort}</td>
                        <td className="px-5 py-4 capitalize text-gray-600">{a.impact}</td>
                        <td className="px-5 py-4 max-w-xs">
                          <p className="text-gray-700 text-xs">{a.indicateur_succes}</p>
                          <p className="mt-1 text-[11px] text-gray-400">Lisible : {a.delai_de_lecture}</p>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Suivi des actions précédentes */}
          {analyse.suivi_actions_precedentes.length > 0 && (
            <Section
              titre="Effet des actions précédentes"
              sous="Chaque action de l'analyse antérieure, jugée sur son propre indicateur"
            >
              <div className="divide-y divide-gray-50">
                {analyse.suivi_actions_precedentes.map((s, i) => (
                  <div key={i} className="px-6 py-4 flex flex-wrap items-start gap-3">
                    <Badge className={COULEUR_STATUT[s.statut] ?? ''}>
                      {LIBELLE_STATUT[s.statut] ?? s.statut}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900">{s.action}</p>
                      <p className="mt-1 text-xs text-gray-500">{s.preuve}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Contexte externe */}
          <Section
            titre="Contexte externe"
            sous={
              veille?.derniere_veille
                ? `Dernière veille du ${new Date(veille.derniere_veille).toLocaleDateString('fr-FR')}. Seuls les faits retenus entrent dans l'analyse.`
                : 'Aucune veille pour le moment. Ces faits servent à expliquer une inflexion déjà mesurée, jamais à la prédire.'
            }
            action={
              <button
                onClick={() => { void relancerVeille(); }}
                disabled={veilleEnCours}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#f57503] hover:underline disabled:opacity-40 whitespace-nowrap"
              >
                <GlobeAmericasIcon className="w-4 h-4" />
                {veilleEnCours ? 'Recherche en cours…' : 'Actualiser la veille'}
              </button>
            }
          >
            {!veille || veille.evenements.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-gray-400">
                Aucun fait externe enregistré.
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {veille.evenements.map((e) => (
                  <div key={String(e._id)} className={`px-6 py-4 flex gap-4 ${e.retenu ? '' : 'opacity-50'}`}>
                    <label className="flex items-start pt-0.5 shrink-0 cursor-pointer" title="Retenir pour l'analyse">
                      <input
                        type="checkbox"
                        checked={e.retenu}
                        onChange={(ev) => { void basculerEvenement(String(e._id), ev.target.checked); }}
                        className="w-4 h-4 rounded border-gray-300 text-[#f57503] focus:ring-[#f57503]"
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">{e.titre}</p>
                        <Badge className="bg-gray-50 text-gray-500 border-gray-200">
                          {LIBELLE_CATEGORIE[e.categorie] ?? e.categorie}
                        </Badge>
                        <Badge className={COULEUR_APPLICABILITE[e.applicabilite_a_nos_sites] ?? ''}>
                          {LIBELLE_APPLICABILITE[e.applicabilite_a_nos_sites] ?? e.applicabilite_a_nos_sites}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-600">{e.description}</p>
                      {e.chiffre_cle && (
                        <p className="mt-1 text-xs text-gray-700">
                          <span className="font-medium">{e.chiffre_cle.valeur}</span>
                          {' — '}{e.chiffre_cle.perimetre}, {e.chiffre_cle.periode_de_reference}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-gray-400">
                        {e.date_debut}{e.date_fin ? ` → ${e.date_fin}` : ''}
                        {e.portee_geographique.length > 0 && ` · ${e.portee_geographique.join(', ')}`}
                        {' · '}
                        <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-[#f57503] hover:underline">
                          {e.source_nom}
                        </a>
                        {` (${e.fiabilite_source.replace(/_/g, ' ')}, ${e.date_publication_source})`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Dossier source */}
          <Section
            titre="Dossier source"
            sous="Les chiffres exacts sur lesquels cette analyse a été produite, figés au moment de l'analyse"
            action={
              <button
                onClick={() => setDossierOuvert((v) => !v)}
                className="text-sm font-medium text-[#f57503] hover:underline whitespace-nowrap"
              >
                {dossierOuvert ? 'Masquer' : 'Afficher'}
              </button>
            }
          >
            {dossierOuvert && (
              <pre className="px-6 py-4 text-[11px] leading-relaxed text-gray-600 overflow-x-auto max-h-[32rem] overflow-y-auto">
                {JSON.stringify(dossier, null, 2)}
              </pre>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
