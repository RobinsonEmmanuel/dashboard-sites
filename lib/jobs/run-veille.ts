/**
 * Job « veille externe » : recherche web sourcée → chronologie datée → MongoDB.
 *
 * Cadré sur les destinations réellement couvertes (celles du tableau éditorial et des
 * sites du dashboard) et sur les marchés linguistiques des sites : une veille non
 * cadrée remonte des faits sans rapport, qui deviennent ensuite des explications
 * commodes pour n'importe quelle variation.
 */

import { getDatabase } from '../mongodb';
import type { Site } from '../models/site';
import { genererVeille, MODELE_VEILLE_UTILISE } from '../trajectory/veille';
import { enregistrerVeille } from '../trajectory/veille-store';
import { COLLECTION_ACTIVITE } from '../editorial/models';

export interface VeilleInput {
  todayStr?: string;
  moisCouverts?: number;
}

export interface VeilleResult {
  runId: string;
  evenements: number;
  nouveaux: number;
  deja_connus: number;
  angles_non_couverts: string[];
  modele: string;
  /** Ce que chaque axe de recherche a rapporté — un axe muet ou en échec se voit ici. */
  collectes: Array<{ axe: string; caracteres: number; citations: number; erreur: string | null }>;
  destinations_cadrees: number;
  marches_cadres: string[];
}

/** Marché linguistique déduit du domaine — sert à écarter les faits hors périmètre. */
function marcheDuSite(site: Site): string {
  const url = site.gscSiteUrl.toLowerCase();
  if (url.endsWith('.fr') || url.includes('.fr/')) return 'France / francophone';
  if (url.includes('.de')) return 'Allemagne / germanophone';
  if (url.includes('viajes') || url.includes('.es')) return 'Espagne / hispanophone';
  return 'International / anglophone';
}

export async function runVeille(input: VeilleInput = {}): Promise<VeilleResult> {
  const aujourdhui = input.todayStr ?? new Date().toISOString().slice(0, 10);
  const db = await getDatabase();

  const sites = await db.collection<Site>('sites').find({ active: true }).toArray();
  const destinationsEditoriales = await db.collection(COLLECTION_ACTIVITE).distinct('destination');

  const destinations = [...new Set([
    ...sites.map((s) => s.name),
    ...destinationsEditoriales.map((d) => String(d)),
  ])].sort();

  const marches = [...new Set(sites.map(marcheDuSite))].sort();

  const resultat = await genererVeille({
    aujourdhui,
    destinations,
    marches,
    moisCouverts: input.moisCouverts,
  });

  const enregistrement = await enregistrerVeille(resultat.evenements, MODELE_VEILLE_UTILISE);

  return {
    runId: enregistrement.runId,
    evenements: resultat.evenements.length,
    nouveaux: enregistrement.nouveaux,
    deja_connus: enregistrement.deja_connus,
    angles_non_couverts: resultat.angles_non_couverts,
    modele: MODELE_VEILLE_UTILISE,
    collectes: resultat.collectes,
    destinations_cadrees: destinations.length,
    marches_cadres: marches,
  };
}
