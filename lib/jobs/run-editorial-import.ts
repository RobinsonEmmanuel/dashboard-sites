/**
 * Import du tableau de production éditoriale (Google Sheets) → MongoDB.
 *
 * Le tableau est lu via l'export CSV public de la feuille : aucune authentification
 * requise tant que le document reste partagé en lecture par lien. S'il passait en
 * accès restreint, il faudrait basculer sur l'API Sheets avec le compte de service
 * déjà utilisé pour GA4/GSC (scope spreadsheets.readonly) et partager le document
 * avec son adresse.
 *
 * L'import est idempotent : chaque (destination, personne, semaine) et chaque
 * (destination, date de photo) est upserté. Relancer un import ne double rien, et la
 * colonne « ACTUEL » du stock construit au fil des jours une série quotidienne.
 */

import { getDatabase } from '../mongodb';
import type { Site } from '../models/site';
import { parseCsv, parseTableauEditorial } from '../editorial/parse-sheet';
import { resoudreDestination, type SiteConnu } from '../editorial/destinations';
import { COLLECTION_ACTIVITE, COLLECTION_STOCK } from '../editorial/models';

const SHEET_ID_DEFAUT = '1XjCE9L9ZQc_hs8HTXNRO1byArpeoR3u66XmPhfC7rjs';
const SHEET_GID_DEFAUT = '1002961302';

export interface EditorialImportInput {
  todayStr?: string;
  /** Lit et analyse le tableau sans rien écrire — pour vérifier une structure modifiée. */
  dryRun?: boolean;
}

export interface EditorialImportResult {
  source: { sheetId: string; gid: string };
  aujourdhui: string;
  dryRun: boolean;
  semaines: Array<{ libelle: string; debut: string; fin: string }>;
  lignesActivite: number;
  lignesStock: number;
  activiteEcrite: number;
  stockEcrit: number;
  /** Destinations lues qu'aucun site du dashboard ne peut porter — à trancher à la main. */
  destinationsNonMappees: Array<{ destination: string; raison: string; nouveaux: number; majs: number }>;
  destinationsMappees: Array<{ destination: string; sites: string[]; dupliquee: boolean }>;
  /** Destinations rattachées à un site inactif : aucune donnée de trafic à confronter. */
  rattacheesASiteInactif: Array<{ destination: string; site: string }>;
  /** Les sites connus au moment de l'import, pour lire les non-rattachées en contexte. */
  sitesConnus: string[];
  /** Ce que le parseur n'a pas su lire. Une liste non vide mérite un coup d'œil au tableau. */
  anomalies: string[];
}

function urlExportCsv(sheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

export async function runEditorialImport(
  input: EditorialImportInput = {},
): Promise<EditorialImportResult> {
  const sheetId = process.env.EDITORIAL_SHEET_ID?.trim() || SHEET_ID_DEFAUT;
  const gid = process.env.EDITORIAL_SHEET_GID?.trim() || SHEET_GID_DEFAUT;
  const aujourdhui = input.todayStr ?? new Date().toISOString().slice(0, 10);
  const dryRun = input.dryRun === true;

  const db = await getDatabase();
  const sitesDb = await db.collection<Site>('sites')
    .find({}, { projection: { shortName: 1, name: 1, active: 1 } })
    .toArray();
  const sitesConnus: SiteConnu[] = sitesDb.map((s) => ({
    shortName: s.shortName, name: s.name, active: s.active,
  }));
  const actifParShortName = new Map(sitesConnus.map((s) => [s.shortName, s.active]));

  const res = await fetch(urlExportCsv(sheetId, gid), { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(
      `Lecture du tableau impossible (HTTP ${res.status}). Le document est-il toujours partagé en lecture par lien ?`,
    );
  }
  const texte = await res.text();
  if (texte.trimStart().startsWith('<')) {
    throw new Error(
      'Google a renvoyé une page HTML au lieu du CSV : le document n\'est plus accessible sans authentification.',
    );
  }

  const tableau = parseTableauEditorial(parseCsv(texte), { aujourdhui });
  const anomalies = [...tableau.anomalies];

  /* ── Résolution destination → site(s) ─────────────────────────────────────── */
  const resolutions = new Map<string, ReturnType<typeof resoudreDestination>>();
  const nonMappees = new Map<string, { raison: string; nouveaux: number; majs: number }>();
  const mappees = new Map<string, { sites: string[]; dupliquee: boolean }>();
  const inactifs = new Map<string, string>();

  const resoudre = (destination: string) => {
    let r = resolutions.get(destination);
    if (!r) { r = resoudreDestination(destination, sitesConnus); resolutions.set(destination, r); }
    return r;
  };

  for (const ligne of tableau.activite) {
    const r = resoudre(ligne.destination);
    const nouveaux = ligne.semaines.reduce((s, w) => s + (w.nouveaux ?? 0), 0);
    const majs = ligne.semaines.reduce((s, w) => s + (w.majs ?? 0), 0);

    if (r.sites.length > 0) {
      mappees.set(ligne.destination, { sites: r.sites, dupliquee: r.dupliquee });
      for (const site of r.sites) {
        // Un site inactif n'est pas ingéré (GA4/GSC ne tournent que sur les actifs) :
        // sa production n'aura aucune série de trafic à confronter.
        if (actifParShortName.get(site) === false) inactifs.set(`${ligne.destination}|${site}`, site);
      }
    } else {
      const acc = nonMappees.get(ligne.destination) ?? { raison: r.raison ?? '', nouveaux: 0, majs: 0 };
      acc.nouveaux += nouveaux;
      acc.majs += majs;
      nonMappees.set(ligne.destination, acc);
    }
  }

  /* ── Écritures ───────────────────────────────────────────────────────────── */
  let activiteEcrite = 0;
  let stockEcrit = 0;
  const importedAt = new Date();

  if (!dryRun) {

    const opsActivite = tableau.activite.flatMap((ligne) => {
      const { sites, dupliquee } = resoudre(ligne.destination);
      return ligne.semaines
        // Une semaine sans aucune saisie n'est pas une semaine à zéro : on ne l'écrit pas.
        .filter((w) => w.nouveaux !== null || w.majs !== null || w.notes.length > 0)
        .map((w) => ({
          updateOne: {
            filter: {
              destination: ligne.destination,
              personne: ligne.personne,
              semaineDebut: w.debut,
            },
            update: {
              $set: {
                destination: ligne.destination,
                sites,
                dupliquee,
                personne: ligne.personne,
                objectif: ligne.objectif,
                semaineDebut: w.debut,
                semaineFin: w.fin,
                mois: w.debut.slice(0, 7),
                nouveaux: w.nouveaux,
                majs: w.majs,
                notes: w.notes,
                importedAt,
              },
            },
            upsert: true,
          },
        }));
    });

    const opsStock = tableau.stock.flatMap((ligne) => {
      const { sites } = resoudre(ligne.destination);
      return ligne.photos
        .filter((p) => p.date && (p.publies !== null || p.resteAMaj !== null))
        .map((p) => ({
          updateOne: {
            filter: { destination: ligne.destination, dateStr: p.date as string },
            update: {
              $set: {
                destination: ligne.destination,
                sites,
                dateStr: p.date as string,
                libelle: p.libelle,
                publies: p.publies,
                resteAMaj: p.resteAMaj,
                importedAt,
              },
            },
            upsert: true,
          },
        }));
    });

    if (opsActivite.length) {
      const r1 = await db.collection(COLLECTION_ACTIVITE).bulkWrite(opsActivite);
      activiteEcrite = r1.upsertedCount + r1.modifiedCount;
    }
    if (opsStock.length) {
      const r2 = await db.collection(COLLECTION_STOCK).bulkWrite(opsStock);
      stockEcrit = r2.upsertedCount + r2.modifiedCount;
    }
  }

  if (nonMappees.size > 0) {
    anomalies.push(
      `${nonMappees.size} destination(s) non rattachée(s) à un site : ${[...nonMappees.keys()].join(', ')}. Leur production est enregistrée mais n'entrera pas dans l'analyse par site.`,
    );
  }
  if (inactifs.size > 0) {
    anomalies.push(
      `Production rattachée à des sites inactifs (${[...new Set(inactifs.values())].join(', ')}) : ces sites ne sont pas ingérés, il n'y aura aucune série de trafic à confronter à leur production.`,
    );
  }

  return {
    source: { sheetId, gid },
    aujourdhui,
    dryRun,
    semaines: tableau.semaines.map((s) => ({ libelle: s.libelle, debut: s.debut, fin: s.fin })),
    lignesActivite: tableau.activite.length,
    lignesStock: tableau.stock.length,
    activiteEcrite,
    stockEcrit,
    destinationsNonMappees: [...nonMappees.entries()].map(([destination, v]) => ({
      destination, ...v,
    })),
    destinationsMappees: [...mappees.entries()].map(([destination, v]) => ({
      destination, sites: v.sites, dupliquee: v.dupliquee,
    })),
    rattacheesASiteInactif: [...inactifs.entries()].map(([cle, site]) => ({
      destination: cle.split('|')[0], site,
    })),
    sitesConnus: sitesConnus.map((s) => s.shortName).sort(),
    anomalies,
  };
}
