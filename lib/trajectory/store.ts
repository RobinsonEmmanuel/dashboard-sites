/**
 * Persistance des analyses de trajectoire.
 *
 * On stocke le dossier COMPLET avec l'analyse, plus son empreinte. Sans ce
 * snapshot, une analyse n'est ni reproductible ni relisible dans six mois : les
 * agrégats changent à chaque import, donc les chiffres cités ne seraient plus
 * retrouvables. L'empreinte permet de voir si deux analyses portent sur les mêmes
 * données.
 */

import { createHash } from 'crypto';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../mongodb';
import type { AnalyseTrajectoireDoc, DossierTrajectoire } from './types';

export const COLLECTION_ANALYSES = 'trajectory_analyses';

/** Empreinte du dossier, hors métadonnées volatiles (date de génération). */
export function empreinteDossier(dossier: DossierTrajectoire): string {
  const { meta, ...reste } = dossier;
  const stable = { ...reste, meta: { ...meta, genere_le: undefined } };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

export async function enregistrerAnalyse(
  doc: Omit<AnalyseTrajectoireDoc, '_id'>,
): Promise<string> {
  const db = await getDatabase();
  const res = await db.collection(COLLECTION_ANALYSES).insertOne(doc);
  return res.insertedId.toString();
}

export async function derniereAnalyse(): Promise<AnalyseTrajectoireDoc | null> {
  const db = await getDatabase();
  const docs = await db.collection(COLLECTION_ANALYSES)
    .find({}).sort({ createdAt: -1 }).limit(1).toArray();
  return docs[0] ? (JSON.parse(JSON.stringify(docs[0])) as AnalyseTrajectoireDoc) : null;
}

export interface ResumeAnalyse {
  id: string;
  createdAt: string;
  dernier_mois_complet: string;
  dossierHash: string;
  modele: string;
  nb_constats: number;
  nb_actions: number;
}

/** Liste sans les dossiers (volumineux) — pour le sélecteur d'historique. */
export async function listerAnalyses(limit = 24): Promise<ResumeAnalyse[]> {
  const db = await getDatabase();
  const docs = await db.collection(COLLECTION_ANALYSES)
    .find({}, {
      projection: {
        createdAt: 1, dernier_mois_complet: 1, dossierHash: 1, modele: 1,
        'analyse.constats': 1, 'analyse.actions': 1,
      },
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return docs.map((d) => ({
    id: d._id.toString(),
    createdAt: new Date(d.createdAt as Date).toISOString(),
    dernier_mois_complet: String(d.dernier_mois_complet ?? ''),
    dossierHash: String(d.dossierHash ?? ''),
    modele: String(d.modele ?? ''),
    nb_constats: Array.isArray(d.analyse?.constats) ? d.analyse.constats.length : 0,
    nb_actions: Array.isArray(d.analyse?.actions) ? d.analyse.actions.length : 0,
  }));
}

export async function analyseParId(id: string): Promise<AnalyseTrajectoireDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDatabase();
  const doc = await db.collection(COLLECTION_ANALYSES).findOne({ _id: new ObjectId(id) });
  return doc ? (JSON.parse(JSON.stringify(doc)) as AnalyseTrajectoireDoc) : null;
}
