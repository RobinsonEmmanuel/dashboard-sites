/**
 * Stockage de la veille externe.
 *
 * Chaque événement est stocké individuellement avec un drapeau `retenu`. Seuls les
 * événements retenus entrent dans l'analyse : un fait issu du web peut être hors sujet
 * ou mal daté, et il finirait sinon par justifier une décision. Écarter un événement ne
 * le supprime pas — il reste visible et réactivable.
 */

import { ObjectId } from 'mongodb';
import { getDatabase } from '../mongodb';
import type { EvenementVeille } from './veille';

export const COLLECTION_VEILLE = 'veille_events';

export interface EvenementVeilleDoc extends EvenementVeille {
  _id?: string;
  runId: string;
  createdAt: Date;
  modele: string;
  retenu: boolean;
}

/** Clé de déduplication entre deux passages de veille : même fait, même date de début. */
function cleEvenement(e: EvenementVeille): { titre: string; date_debut: string } {
  return { titre: e.titre.trim(), date_debut: e.date_debut };
}

export interface EnregistrementVeille {
  runId: string;
  nouveaux: number;
  deja_connus: number;
}

export async function enregistrerVeille(
  evenements: EvenementVeille[],
  modele: string,
): Promise<EnregistrementVeille> {
  const db = await getDatabase();
  const col = db.collection(COLLECTION_VEILLE);
  const runId = new ObjectId().toString();
  const createdAt = new Date();

  let nouveaux = 0;
  let dejaConnus = 0;

  for (const e of evenements) {
    const filtre = cleEvenement(e);
    const existant = await col.findOne(filtre, { projection: { _id: 1 } });
    if (existant) {
      // Un fait déjà connu est rafraîchi (source, chiffre) mais garde son drapeau `retenu`.
      await col.updateOne(filtre, { $set: { ...e, runId, modele, updatedAt: createdAt } });
      dejaConnus++;
    } else {
      await col.insertOne({ ...e, runId, createdAt, modele, retenu: true });
      nouveaux++;
    }
  }

  return { runId, nouveaux, deja_connus: dejaConnus };
}

export async function listerVeille(opts: { seulementRetenus?: boolean } = {}): Promise<EvenementVeilleDoc[]> {
  const db = await getDatabase();
  const filtre = opts.seulementRetenus ? { retenu: true } : {};
  const docs = await db.collection(COLLECTION_VEILLE)
    .find(filtre)
    .sort({ date_debut: -1 })
    .limit(200)
    .toArray();
  return JSON.parse(JSON.stringify(docs)) as EvenementVeilleDoc[];
}

export async function basculerRetenu(id: string, retenu: boolean): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDatabase();
  const res = await db.collection(COLLECTION_VEILLE)
    .updateOne({ _id: new ObjectId(id) }, { $set: { retenu } });
  return res.matchedCount > 0;
}

export async function dateDerniereVeille(): Promise<string | null> {
  const db = await getDatabase();
  const docs = await db.collection(COLLECTION_VEILLE)
    .find({}, { projection: { createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();
  return docs[0]?.createdAt ? new Date(docs[0].createdAt as Date).toISOString().slice(0, 10) : null;
}
