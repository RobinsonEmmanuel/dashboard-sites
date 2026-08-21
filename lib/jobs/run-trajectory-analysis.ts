/**
 * Job « analyse de trajectoire » : dossier déterministe → deux passes OpenAI →
 * persistance. Exécuté par le worker Railway (BullMQ) car les deux appels avec
 * raisonnement élevé dépassent largement la durée d'une fonction Vercel.
 */

import { buildTrajectoryDossier } from '../trajectory/build-dossier';
import { genererAnalyse, genererRedaction, MODELE_UTILISE } from '../trajectory/analyze';
import { derniereAnalyse, empreinteDossier, enregistrerAnalyse } from '../trajectory/store';

export interface TrajectoryAnalysisInput {
  /** Surcharge d'« aujourd'hui » (YYYY-MM-DD) — utile pour rejouer une date. */
  todayStr?: string;
  /** Ne pas injecter les actions de l'analyse précédente (première analyse propre). */
  sansSuivi?: boolean;
}

export interface TrajectoryAnalysisResult {
  analysisId: string;
  dernier_mois_complet: string;
  dossierHash: string;
  modele: string;
  nb_constats: number;
  nb_actions: number;
  nb_scenarios: number;
  nb_suivis: number;
  /** Vrai si le dossier est identique à celui de l'analyse précédente. */
  dossier_inchange: boolean;
}

export async function runTrajectoryAnalysis(
  input: TrajectoryAnalysisInput = {},
): Promise<TrajectoryAnalysisResult> {
  const precedente = input.sansSuivi ? null : await derniereAnalyse();

  const actionsPrecedentes = precedente
    ? precedente.analyse.actions.map((a) => ({
        action: a.action,
        indicateur_succes: a.indicateur_succes,
        analyse_du: new Date(precedente.createdAt).toISOString().slice(0, 10),
      }))
    : [];

  const dossier = await buildTrajectoryDossier({
    todayStr: input.todayStr,
    actionsPrecedentes,
  });
  const dossierHash = empreinteDossier(dossier);

  const analyse = await genererAnalyse(dossier);
  const redaction = await genererRedaction(analyse.contenu, {
    dernier_mois_complet: dossier.meta.dernier_mois_complet,
  });

  const analysisId = await enregistrerAnalyse({
    createdAt: new Date(),
    aujourdhui: dossier.meta.aujourdhui,
    dernier_mois_complet: dossier.meta.dernier_mois_complet,
    dossierHash,
    dossier,
    modele: MODELE_UTILISE,
    analyse: analyse.contenu,
    redaction: redaction.contenu,
    usage: { analyse: analyse.usage, redaction: redaction.usage },
  });

  return {
    analysisId,
    dernier_mois_complet: dossier.meta.dernier_mois_complet,
    dossierHash,
    modele: MODELE_UTILISE,
    nb_constats: analyse.contenu.constats.length,
    nb_actions: analyse.contenu.actions.length,
    nb_scenarios: analyse.contenu.trajectoire.length,
    nb_suivis: analyse.contenu.suivi_actions_precedentes.length,
    dossier_inchange: precedente?.dossierHash === dossierHash,
  };
}
