/**
 * Contexte métier — lecture et écriture en base.
 *
 * Ce bloc est le seul du dossier qui ne peut PAS être calculé ni recherché : il porte
 * l'intention (objectifs, arbitrages d'investissement, décisions à trancher), qui
 * n'existe nulle part ailleurs que dans la tête de l'équipe. Un modèle qui la devinerait
 * produirait des objectifs plausibles mais faux, et l'analyse entière s'optimiserait
 * pour la mauvaise cible.
 *
 * Il vit en base plutôt que dans le code : une intention change plus souvent qu'on ne
 * déploie. L'historique reste interprétable malgré tout, puisque chaque analyse est
 * persistée avec le dossier complet, contexte inclus, tel qu'il était ce jour-là.
 */

import { getDatabase } from '../mongodb';
import { CONTEXTE_METIER_DEFAUT, type ContexteMetier } from './context';

export const COLLECTION_CONTEXTE = 'trajectory_context';

/** Document unique : un seul contexte courant. */
const CLE = 'courant';

/** Un texte de gabarit non remplacé vaut « non renseigné », pas une consigne. */
function estGabarit(valeur: string): boolean {
  return /À COMPLÉTER/i.test(valeur);
}

function nettoyerListe(valeurs: unknown): string[] {
  if (!Array.isArray(valeurs)) return [];
  return valeurs
    .map((v) => String(v ?? '').trim())
    .filter((v) => v.length > 0 && !estGabarit(v));
}

function nettoyerTexte(valeur: unknown): string {
  const t = String(valeur ?? '').trim();
  return estGabarit(t) ? '' : t;
}

export function normaliserContexte(brut: Partial<ContexteMetier> | null | undefined): ContexteMetier {
  return {
    horizon: nettoyerTexte(brut?.horizon),
    objectifs: nettoyerListe(brut?.objectifs),
    sites_en_investissement: nettoyerListe(brut?.sites_en_investissement),
    sites_en_recolte: nettoyerListe(brut?.sites_en_recolte),
    contraintes: nettoyerListe(brut?.contraintes),
    decisions_ouvertes: nettoyerListe(brut?.decisions_ouvertes),
    evenements_a_connaitre: nettoyerListe(brut?.evenements_a_connaitre),
  };
}

/** Champs vides — repris tels quels dans le dossier pour que le modèle ne suppose rien. */
export function champsNonRenseignes(c: ContexteMetier): string[] {
  const manquants: string[] = [];
  if (!c.horizon) manquants.push('horizon');
  if (c.objectifs.length === 0) manquants.push('objectifs');
  if (c.contraintes.length === 0) manquants.push('contraintes');
  if (c.decisions_ouvertes.length === 0) manquants.push('decisions_ouvertes');
  if (c.sites_en_investissement.length === 0 && c.sites_en_recolte.length === 0) {
    manquants.push('arbitrage investissement / récolte');
  }
  return manquants;
}

export interface ContexteEnregistre {
  contexte: ContexteMetier;
  champs_non_renseignes: string[];
  modifie_le: string | null;
}

export async function lireContexte(): Promise<ContexteEnregistre> {
  const db = await getDatabase();
  const doc = await db.collection(COLLECTION_CONTEXTE).findOne({ _id: CLE as unknown as never });

  // Sans document, on repart du gabarit du code — dont les champs de démonstration
  // sont éliminés par la normalisation, donc le contexte ressort vide et honnête.
  const contexte = normaliserContexte(
    (doc?.contexte as Partial<ContexteMetier> | undefined) ?? CONTEXTE_METIER_DEFAUT,
  );

  return {
    contexte,
    champs_non_renseignes: champsNonRenseignes(contexte),
    modifie_le: doc?.updatedAt ? new Date(doc.updatedAt as Date).toISOString() : null,
  };
}

export async function ecrireContexte(brut: Partial<ContexteMetier>): Promise<ContexteEnregistre> {
  const contexte = normaliserContexte(brut);
  const db = await getDatabase();
  const updatedAt = new Date();
  await db.collection(COLLECTION_CONTEXTE).updateOne(
    { _id: CLE as unknown as never },
    { $set: { contexte, updatedAt } },
    { upsert: true },
  );
  return {
    contexte,
    champs_non_renseignes: champsNonRenseignes(contexte),
    modifie_le: updatedAt.toISOString(),
  };
}
