/**
 * Construction du « dossier de trajectoire » — couche 100 % déterministe.
 *
 * Principe (repris de l'audit IA destinations) : le modèle ne calcule RIEN. Tout ce
 * qu'il voit est agrégé ici, arrondi ici, et nommé en langage métier ici. Le dossier
 * est exposé tel quel par `GET /api/trajectory/dossier` : chaque preuve citée dans
 * une analyse doit être retrouvable dans ce JSON.
 *
 * Clé de jointure entre les sources : le `shortName` du site.
 *   - traffic_daily / gsc_daily  → champ `shortName`
 *   - affiliation_revenue        → champ `siteName` (contient le shortName, cf. lib/affiliate-maps.ts)
 */

import { getDatabase } from '../mongodb';
import type { AffiliationPartner } from '../models/revenue';
import type { Site } from '../models/site';
import { lireContexte } from './context-store';
import { COLLECTION_ACTIVITE, COLLECTION_STOCK } from '../editorial/models';
import { dateDerniereVeille, listerVeille } from './veille-store';
import {
  addMonths,
  lastCompleteMonth,
  moisLisible,
  monthEnd,
  monthOf,
  monthSeries,
  monthStart,
  shiftYears,
} from './months';
import type {
  Annulations,
  ContexteExterne,
  ProductionEditoriale,
  CarnetCommandes,
  Concentration,
  DelaiReservation,
  DossierTrajectoire,
  EntonnoirSite,
  EtapesEntonnoir,
  KpisPeriode,
  LevierSeo,
  MoisGroupe,
  MoisSite,
  SourceDonnee,
  TauxEntonnoir,
} from './types';

export const PARTENAIRES: AffiliationPartner[] = [
  'getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl',
];

/** Longueur des séries. Le groupe porte l'historique long, le site le détail récent. */
const MOIS_GROUPE = 36;
const MOIS_PAR_SITE = 24;

const NON_ATTRIBUE = '(non attribué)';

/* ── Arrondis : jamais de décimale brute dans le dossier ──────────────────── */
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const part = (num: number, den: number) => (den > 0 ? r1((num / den) * 100) : null);
const evo = (cur: number, prev: number) => (prev > 0 ? r1(((cur - prev) / prev) * 100) : null);
const div = (num: number, den: number, round: (n: number) => number = r2) =>
  den > 0 ? round(num / den) : null;

/* ── Filtres et étapes Mongo réutilisés ───────────────────────────────────── */
const NON_ANNULE = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };

/** Date de commande : Booking = date de réservation, autres = date de transaction. */
const ETAPE_DATE_PROMESSE = {
  $addFields: {
    _d: {
      $cond: [
        { $and: [{ $eq: ['$partner', 'booking'] }, { $gt: ['$bookingDateStr', null] }] },
        '$bookingDateStr',
        '$dateStr',
      ],
    },
  },
};

/** Date d'encaissement : Booking = check-out (commission réalisée), autres = transaction. */
const ETAPE_DATE_REALISE = {
  $addFields: {
    _d: {
      $cond: [
        { $and: [{ $eq: ['$partner', 'booking'] }, { $gt: ['$checkOutDateStr', null] }] },
        '$checkOutDateStr',
        '$dateStr',
      ],
    },
  },
};

const ETAPE_SITE = {
  $addFields: {
    _site: { $cond: [{ $in: ['$siteName', [null, '']] }, NON_ATTRIBUE, '$siteName'] },
  },
};

const MOIS_DE_D = { $substrBytes: ['$_d', 0, 7] };

type CleMois = string;

interface AccMois {
  promesses: number;
  commandes: number;
  parPartenaire: Map<AffiliationPartner, number>;
  realise: number;
  sessions: number;
  clicsSortants: number;
  clicsSeo: number;
  impressions: number;
  ctrPondere: number;
  posPondere: number;
}

type AccSiteMois = AccMois;

function accVide(): AccMois {
  return {
    promesses: 0, commandes: 0, parPartenaire: new Map(), realise: 0,
    sessions: 0, clicsSortants: 0, clicsSeo: 0, impressions: 0,
    ctrPondere: 0, posPondere: 0,
  };
}

function ajoute(cible: AccMois, source: AccMois): void {
  cible.promesses += source.promesses;
  cible.commandes += source.commandes;
  cible.realise += source.realise;
  cible.sessions += source.sessions;
  cible.clicsSortants += source.clicsSortants;
  cible.clicsSeo += source.clicsSeo;
  cible.impressions += source.impressions;
  cible.ctrPondere += source.ctrPondere;
  cible.posPondere += source.posPondere;
  for (const [p, v] of source.parPartenaire) {
    cible.parPartenaire.set(p, (cible.parPartenaire.get(p) ?? 0) + v);
  }
}

export interface BuildDossierOptions {
  todayStr?: string;
  /** Actions de l'analyse précédente, pour que le modèle statue sur leur effet. */
  actionsPrecedentes?: DossierTrajectoire['actions_precedentes'];
}

export async function buildTrajectoryDossier(
  opts: BuildDossierOptions = {},
): Promise<DossierTrajectoire> {
  const db = await getDatabase();
  const aujourdhui = opts.todayStr ?? new Date().toISOString().slice(0, 10);
  const moisCourant = monthOf(aujourdhui);
  const axe = monthSeries(moisCourant, MOIS_GROUPE);
  const debutAxe = monthStart(axe[0]);
  const finAxe = monthEnd(moisCourant);

  const rev = db.collection('affiliation_revenue');

  /* ── 1. Métadonnées de fraîcheur et séries brutes ─────────────────────── */
  /* Photo de stock la plus récente, et celle d'il y a trois mois pour l'évolution. */
  const ilYa3Mois = monthEnd(addMonths(moisCourant, -3));

  const [
    sites, dernierTraficDocs, dernierGscDocs, fraicheurRevenus, premiersMoisDocs,
    promessesBrutes, realiseBrut, traficBrut, gscBrut,
    editoRows, stockRows, stockAnterieurRows, evenementsVeille, veilleLe, contexteEnregistre,
  ] = await Promise.all([
    db.collection<Site>('sites')
      .find({}, {
        projection: {
          name: 1, shortName: 1, active: 1,
          bookingAffiliateId: 1, gygCampaign: 1, discoverCarsChan: 1, tiqetsCampaign: 1,
        },
      })
      .toArray(),

    db.collection('traffic_daily')
      .find({}, { projection: { dateStr: 1 } }).sort({ dateStr: -1 }).limit(1).toArray(),

    db.collection('gsc_daily')
      .find({}, { projection: { dateStr: 1 } }).sort({ dateStr: -1 }).limit(1).toArray(),

    rev.aggregate([
      { $group: {
        _id: '$partner',
        dernierJourTransaction: { $max: '$dateStr' },
        dernierJourReservation: { $max: '$bookingDateStr' },
        dernierImport: { $max: '$importedAt' },
        commandes: { $sum: 1 },
      } },
    ]).toArray(),

    db.collection('traffic_daily').aggregate([
      { $group: { _id: '$shortName', premierJour: { $min: '$dateStr' } } },
    ]).toArray(),

    rev.aggregate([
      ETAPE_DATE_PROMESSE, ETAPE_SITE,
      { $match: { $and: [{ _d: { $gte: debutAxe, $lte: finAxe } }, NON_ANNULE] } },
      { $group: {
        _id: { mois: MOIS_DE_D, partner: '$partner', site: '$_site' },
        montant: { $sum: '$commissionActual' },
        commandes: { $sum: 1 },
      } },
    ]).toArray(),

    rev.aggregate([
      ETAPE_DATE_REALISE,
      { $match: { $and: [{ _d: { $gte: debutAxe, $lte: finAxe } }, NON_ANNULE] } },
      { $group: { _id: MOIS_DE_D, montant: { $sum: '$commissionActual' } } },
    ]).toArray(),

    db.collection('traffic_daily').aggregate([
      { $match: { dateStr: { $gte: debutAxe, $lte: finAxe } } },
      { $group: {
        _id: { mois: { $substrBytes: ['$dateStr', 0, 7] }, site: '$shortName' },
        sessions: { $sum: '$sessions' },
        clicsSortants: { $sum: '$outboundClicks' },
      } },
    ]).toArray(),

    db.collection('gsc_daily').aggregate([
      { $match: { dateStr: { $gte: debutAxe, $lte: finAxe } } },
      { $group: {
        _id: { mois: { $substrBytes: ['$dateStr', 0, 7] }, site: '$shortName' },
        clics: { $sum: '$clicks' },
        impressions: { $sum: '$impressions' },
        ctrPondere: { $sum: { $multiply: ['$ctr', '$impressions'] } },
        posPondere: { $sum: { $multiply: ['$position', '$impressions'] } },
      } },
    ]).toArray(),
    // Production éditoriale par mois et par destination. La ventilation vers les sites
    // se fait ensuite en mémoire : une destination peut alimenter plusieurs sites.
    db.collection(COLLECTION_ACTIVITE).aggregate([
      { $match: { mois: { $gte: axe[0], $lte: moisCourant } } },
      { $group: {
        _id: { mois: '$mois', destination: '$destination' },
        sites: { $first: '$sites' },
        nouveaux: { $sum: { $ifNull: ['$nouveaux', 0] } },
        majs: { $sum: { $ifNull: ['$majs', 0] } },
      } },
    ]).toArray(),

    db.collection(COLLECTION_STOCK).aggregate([
      { $sort: { dateStr: -1 } },
      { $group: {
        _id: '$destination',
        sites: { $first: '$sites' },
        dateStr: { $first: '$dateStr' },
        publies: { $first: '$publies' },
        resteAMaj: { $first: '$resteAMaj' },
      } },
    ]).toArray(),

    db.collection(COLLECTION_STOCK).aggregate([
      { $match: { dateStr: { $lte: ilYa3Mois } } },
      { $sort: { dateStr: -1 } },
      { $group: {
        _id: '$destination',
        publies: { $first: '$publies' },
        resteAMaj: { $first: '$resteAMaj' },
      } },
    ]).toArray(),

    listerVeille({ seulementRetenus: true }),
    dateDerniereVeille(),
    lireContexte(),
  ]);

  const dernierJourTrafic = (dernierTraficDocs[0]?.dateStr as string) ?? null;
  const dernierJourGsc = (dernierGscDocs[0]?.dateStr as string) ?? null;

  /* Fraîcheur revenus : pour Booking, `dateStr` est une date de check-in (souvent
   * future) — seule la date de RÉSERVATION renseigne sur la fraîcheur de l'import. */
  let dernierJourRevenus: string | null = null;
  const fraicheurParPartenaire = PARTENAIRES.map((p) => {
    const row = fraicheurRevenus.find((r) => r._id === p);
    const jour = p === 'booking'
      ? (row?.dernierJourReservation as string | undefined) ?? null
      : (row?.dernierJourTransaction as string | undefined) ?? null;
    const jourBorne = jour && jour > aujourdhui ? aujourdhui : jour;
    if (jourBorne && (!dernierJourRevenus || jourBorne > dernierJourRevenus)) {
      dernierJourRevenus = jourBorne;
    }
    const importe = row?.dernierImport as Date | string | undefined;
    return {
      partenaire: p,
      dernier_jour_commande: jourBorne,
      dernier_import: importe ? new Date(importe).toISOString().slice(0, 10) : null,
      commandes_en_base: (row?.commandes as number | undefined) ?? 0,
    };
  });

  /* ── 2. Dernier mois complet : borne de toute lecture de tendance ──────── */
  const candidats = [
    lastCompleteMonth(dernierJourTrafic),
    lastCompleteMonth(dernierJourGsc),
    lastCompleteMonth(dernierJourRevenus),
  ].filter((m): m is string => Boolean(m));
  const moisPrecedent = addMonths(moisCourant, -1);
  const dernierMoisComplet = candidats.length
    ? candidats.reduce((a, b) => (a < b ? a : b))
    : moisPrecedent;
  const moisRef = dernierMoisComplet < moisPrecedent ? dernierMoisComplet : moisPrecedent;

  const moisIncomplets: Record<SourceDonnee, string[]> = {
    trafic: axe.filter((m) => !dernierJourTrafic || dernierJourTrafic < monthEnd(m)),
    seo: axe.filter((m) => !dernierJourGsc || dernierJourGsc < monthEnd(m)),
    revenus: axe.filter((m) => !dernierJourRevenus || dernierJourRevenus < monthEnd(m)),
  };

  /* ── 3. Consolidation en mémoire ──────────────────────────────────────── */
  const parMois = new Map<CleMois, AccMois>();
  const parSiteMois = new Map<string, Map<CleMois, AccSiteMois>>();
  const sitesVus = new Set<string>();

  const accMois = (mois: string): AccMois => {
    let a = parMois.get(mois);
    if (!a) { a = accVide(); parMois.set(mois, a); }
    return a;
  };
  const accSite = (site: string, mois: string): AccSiteMois => {
    sitesVus.add(site);
    let parM = parSiteMois.get(site);
    if (!parM) { parM = new Map(); parSiteMois.set(site, parM); }
    let a = parM.get(mois);
    if (!a) { a = accVide(); parM.set(mois, a); }
    return a;
  };

  for (const row of promessesBrutes) {
    const { mois, partner, site } = row._id as { mois: string; partner: AffiliationPartner; site: string };
    const montant = Number(row.montant ?? 0);
    const commandes = Number(row.commandes ?? 0);

    const g = accMois(mois);
    g.promesses += montant;
    g.commandes += commandes;
    g.parPartenaire.set(partner, (g.parPartenaire.get(partner) ?? 0) + montant);

    // Le revenu non attribué compte dans le groupe mais n'est imputable à aucun site.
    if (site !== NON_ATTRIBUE) {
      const s = accSite(site, mois);
      s.promesses += montant;
      s.commandes += commandes;
      s.parPartenaire.set(partner, (s.parPartenaire.get(partner) ?? 0) + montant);
    }
  }

  for (const row of realiseBrut) {
    accMois(row._id as string).realise += Number(row.montant ?? 0);
  }

  for (const row of traficBrut) {
    const { mois, site } = row._id as { mois: string; site: string };
    const sessions = Number(row.sessions ?? 0);
    const clicsSortants = Number(row.clicsSortants ?? 0);
    const g = accMois(mois); g.sessions += sessions; g.clicsSortants += clicsSortants;
    const s = accSite(site, mois); s.sessions += sessions; s.clicsSortants += clicsSortants;
  }

  for (const row of gscBrut) {
    const { mois, site } = row._id as { mois: string; site: string };
    const clics = Number(row.clics ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const ctrPondere = Number(row.ctrPondere ?? 0);
    const posPondere = Number(row.posPondere ?? 0);
    for (const a of [accMois(mois), accSite(site, mois)]) {
      a.clicsSeo += clics; a.impressions += impressions;
      a.ctrPondere += ctrPondere; a.posPondere += posPondere;
    }
  }

  /* ── 3 bis. Production éditoriale ─────────────────────────────────────── */
  /* Deux mesures à ne jamais confondre :
   *  - ARTICLES PRODUITS : le travail de rédaction, compté une fois.
   *  - PUBLICATIONS : le même article compte sur chaque site qui le porte. Les articles
   *    ZigZag sont publiés à l'identique sur ZZ FR et ZZ EN — deux publications, une
   *    seule rédaction. Additionner les sites donnerait un effort deux fois trop grand.
   */
  const cleSiteMois = (site: string, mois: string) => `${site}|${mois}`;
  const editoParSiteMois = new Map<string, { nouveaux: number; majs: number }>();
  const editoProduitsParMois = new Map<string, { nouveaux: number; majs: number }>();
  const editoPublicationsParMois = new Map<string, { nouveaux: number; majs: number }>();
  const editoNonRattachees = new Map<string, { nouveaux: number; majs: number }>();
  const editoDupliquees = new Set<string>();
  /* Mois effectivement couverts par le suivi éditorial. Hors de cet ensemble, la
   * production vaut null et non zéro : le tableau ne remonte pas jusque-là, et lire
   * un zéro ferait croire à un arrêt de la production. */
  const moisAvecEdito = new Set<string>();

  const ajouteA = (
    carte: Map<string, { nouveaux: number; majs: number }>,
    cle: string,
    nouveaux: number,
    majs: number,
  ) => {
    const a = carte.get(cle) ?? { nouveaux: 0, majs: 0 };
    a.nouveaux += nouveaux; a.majs += majs;
    carte.set(cle, a);
  };

  for (const row of editoRows) {
    const { mois, destination } = row._id as { mois: string; destination: string };
    const sitesPorteurs = (row.sites as string[] | undefined) ?? [];
    const nouveaux = Number(row.nouveaux ?? 0);
    const majs = Number(row.majs ?? 0);
    moisAvecEdito.add(mois);

    ajouteA(editoProduitsParMois, mois, nouveaux, majs);

    if (sitesPorteurs.length === 0) {
      ajouteA(editoNonRattachees, destination, nouveaux, majs);
      continue;
    }
    if (sitesPorteurs.length > 1) editoDupliquees.add(destination);

    for (const site of sitesPorteurs) {
      ajouteA(editoParSiteMois, cleSiteMois(site, mois), nouveaux, majs);
      ajouteA(editoPublicationsParMois, mois, nouveaux, majs);
    }
  }

  const cumuleEdito = (site: string, moisListe: string[]) => {
    const couverts = moisListe.filter((m) => moisAvecEdito.has(m));
    if (couverts.length === 0) return { nouveaux: null, majs: null };
    return couverts.reduce(
      (acc, m) => {
        const a = editoParSiteMois.get(cleSiteMois(site, m));
        return { nouveaux: acc.nouveaux + (a?.nouveaux ?? 0), majs: acc.majs + (a?.majs ?? 0) };
      },
      { nouveaux: 0, majs: 0 } as { nouveaux: number; majs: number },
    );
  };

  /* ── 4. Série mensuelle groupe ────────────────────────────────────────── */
  const serieGroupe: MoisGroupe[] = axe.map((mois) => {
    const a = parMois.get(mois) ?? accVide();
    const incomplet = (['trafic', 'seo', 'revenus'] as SourceDonnee[])
      .filter((src) => moisIncomplets[src].includes(mois));
    const parPartenaire: Partial<Record<AffiliationPartner, number>> = {};
    for (const p of PARTENAIRES) {
      const v = a.parPartenaire.get(p);
      if (v) parPartenaire[p] = r0(v);
    }
    return {
      mois,
      promesses: r0(a.promesses),
      promesses_par_partenaire: parPartenaire,
      commandes: a.commandes,
      realise: r0(a.realise),
      sessions: a.sessions,
      clics_sortants: a.clicsSortants,
      clics_seo: a.clicsSeo,
      impressions: a.impressions,
      ctr_seo_pct: a.impressions > 0 ? r1((a.ctrPondere / a.impressions) * 100) : null,
      position_seo: a.impressions > 0 ? r1(a.posPondere / a.impressions) : null,
      rpm: div(a.promesses * 1000, a.sessions),
      incomplet,
    };
  });

  /* ── 5. Série mensuelle par site (24 derniers mois émis) ──────────────── */
  const moisEmisParSite = axe.slice(-MOIS_PAR_SITE);
  const sitesTries = [...sitesVus].sort();
  const serieParSite: MoisSite[] = [];
  for (const site of sitesTries) {
    for (const mois of moisEmisParSite) {
      const a = parSiteMois.get(site)?.get(mois);
      if (!a) continue;
      if (!a.sessions && !a.impressions && !a.promesses) continue;
      const edito = editoParSiteMois.get(cleSiteMois(site, mois));
      serieParSite.push({
        site, mois,
        articles_nouveaux: moisAvecEdito.has(mois) ? (edito?.nouveaux ?? 0) : null,
        articles_maj: moisAvecEdito.has(mois) ? (edito?.majs ?? 0) : null,
        sessions: a.sessions,
        clics_sortants: a.clicsSortants,
        clics_seo: a.clicsSeo,
        impressions: a.impressions,
        position_seo: a.impressions > 0 ? r1(a.posPondere / a.impressions) : null,
        promesses: r0(a.promesses),
        commandes: a.commandes,
      });
    }
  }

  /* ── 6. Périodes comparables ──────────────────────────────────────────── */
  const r12 = monthSeries(moisRef, 12);
  const r12n1 = monthSeries(addMonths(moisRef, -12), 12);
  const anneeRef = Number(moisRef.slice(0, 4));
  const nbMoisYtd = Number(moisRef.slice(5, 7));
  const ytd = monthSeries(moisRef, nbMoisYtd);
  const ytdN1 = ytd.map((m) => addMonths(m, -12));
  const ytdN2 = ytd.map((m) => addMonths(m, -24));

  const cumule = (moisListe: string[]): AccMois => {
    const total = accVide();
    for (const m of moisListe) {
      const a = parMois.get(m);
      if (a) ajoute(total, a);
    }
    return total;
  };

  const kpis = (libelle: string, moisListe: string[]): KpisPeriode => {
    const a = cumule(moisListe);
    return {
      libelle,
      debut: monthStart(moisListe[0]),
      fin: monthEnd(moisListe[moisListe.length - 1]),
      sessions: a.sessions,
      clics_sortants: a.clicsSortants,
      clics_seo: a.clicsSeo,
      impressions: a.impressions,
      ctr_seo_pct: a.impressions > 0 ? r1((a.ctrPondere / a.impressions) * 100) : null,
      position_seo: a.impressions > 0 ? r1(a.posPondere / a.impressions) : null,
      promesses: r0(a.promesses),
      realise: r0(a.realise),
      commandes: a.commandes,
      rpm: div(a.promesses * 1000, a.sessions),
      commission_moyenne_par_commande: div(a.promesses, a.commandes),
    };
  };

  const kR12 = kpis(`12 mois glissants jusqu'à ${moisLisible(moisRef)}`, r12);
  const kR12n1 = kpis('Mêmes 12 mois, un an plus tôt', r12n1);
  const kYtd = kpis(`${anneeRef} à fin ${moisLisible(moisRef)}`, ytd);
  const kYtdN1 = kpis(`${anneeRef - 1} sur la même fraction d'année`, ytdN1);
  const kYtdN2 = kpis(`${anneeRef - 2} sur la même fraction d'année`, ytdN2);

  const evolutions = (a: KpisPeriode, b: KpisPeriode): Record<string, number | null> => ({
    sessions: evo(a.sessions, b.sessions),
    clics_sortants: evo(a.clics_sortants, b.clics_sortants),
    clics_seo: evo(a.clics_seo, b.clics_seo),
    impressions: evo(a.impressions, b.impressions),
    promesses: evo(a.promesses, b.promesses),
    realise: evo(a.realise, b.realise),
    commandes: evo(a.commandes, b.commandes),
    rpm: a.rpm !== null && b.rpm ? evo(a.rpm, b.rpm) : null,
  });

  /* ── 7. Entonnoir par site ────────────────────────────────────────────── */
  const premierMoisParSite = new Map<string, string>();
  for (const row of premiersMoisDocs) {
    if (row._id && row.premierJour) {
      premierMoisParSite.set(String(row._id), monthOf(String(row.premierJour)));
    }
  }

  const siteMeta = new Map(sites.map((s) => [s.shortName, s]));
  const codesManquants = (s: Site | undefined): string[] => {
    if (!s) return [];
    const manquants: string[] = [];
    if (!s.bookingAffiliateId) manquants.push('booking');
    if (!s.gygCampaign) manquants.push('getyourguide');
    if (!s.discoverCarsChan) manquants.push('discovercars');
    if (!s.tiqetsCampaign) manquants.push('tiqets');
    return manquants;
  };

  const cumuleSite = (site: string, moisListe: string[]): AccMois => {
    const total = accVide();
    const parM = parSiteMois.get(site);
    if (!parM) return total;
    for (const m of moisListe) {
      const a = parM.get(m);
      if (a) ajoute(total, a);
    }
    return total;
  };

  const etapes = (a: AccMois): EtapesEntonnoir => ({
    impressions: a.impressions,
    clics_seo: a.clicsSeo,
    sessions: a.sessions,
    clics_sortants: a.clicsSortants,
    commandes: a.commandes,
    promesses: r0(a.promesses),
  });

  const taux = (a: AccMois): TauxEntonnoir => ({
    ctr_seo_pct: a.impressions > 0 ? r1((a.clicsSeo / a.impressions) * 100) : null,
    sessions_par_clic_seo: div(a.sessions, a.clicsSeo),
    clics_sortants_pour_100_sessions: div(a.clicsSortants * 100, a.sessions, r1),
    commandes_pour_100_clics_sortants: div(a.commandes * 100, a.clicsSortants, r1),
    rpm: div(a.promesses * 1000, a.sessions),
    commission_moyenne_par_commande: div(a.promesses, a.commandes),
  });

  /* Stock d'articles : dernière photo par destination, rattachée au site quand elle l'est. */
  const stockParSite = new Map<string, { destination: string; date: string; publies: number | null; resteAMaj: number | null }>();
  /* Plusieurs destinations peuvent pointer vers un même site : les stocks s'additionnent.
   * Une absence de valeur reste une absence — elle ne devient pas zéro par addition. */
  const somme = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  for (const row of stockRows) {
    const sitesPorteurs = (row.sites as string[] | undefined) ?? [];
    for (const site of sitesPorteurs) {
      const existant = stockParSite.get(site);
      stockParSite.set(site, {
        destination: existant ? `${existant.destination} + ${row._id}` : String(row._id),
        date: String(row.dateStr),
        publies: somme(existant?.publies ?? null, (row.publies as number | null) ?? null),
        resteAMaj: somme(existant?.resteAMaj ?? null, (row.resteAMaj as number | null) ?? null),
      });
    }
  }
  const stockAnterieurParDestination = new Map(
    stockAnterieurRows.map((r) => [String(r._id), {
      publies: r.publies as number | null,
      resteAMaj: r.resteAMaj as number | null,
    }]),
  );

  const entonnoir: EntonnoirSite[] = sitesTries.map((site) => {
    const cur = cumuleSite(site, r12);
    const prev = cumuleSite(site, r12n1);
    const meta = siteMeta.get(site);
    const prod = cumuleEdito(site, r12);
    const stock = stockParSite.get(site);
    return {
      site,
      actif: meta?.active ?? false,
      premier_mois_trafic: premierMoisParSite.get(site) ?? null,
      courant: etapes(cur),
      n1: etapes(prev),
      taux: taux(cur),
      taux_n1: taux(prev),
      evolution_pct: {
        sessions: evo(cur.sessions, prev.sessions),
        clics_seo: evo(cur.clicsSeo, prev.clicsSeo),
        impressions: evo(cur.impressions, prev.impressions),
        promesses: evo(cur.promesses, prev.promesses),
      },
      codes_affiliation_manquants: codesManquants(meta),
      production: {
        articles_nouveaux: prod.nouveaux,
        articles_maj: prod.majs,
        articles_publies: stock?.publies ?? null,
        reste_a_maj: stock?.resteAMaj ?? null,
      },
    };
  }).sort((a, b) => b.courant.promesses - a.courant.promesses);

  /* ── 8. Requêtes ciblées (carnet, délais, annulations, non attribué, SEO) ─ */
  const aujourdhuiN1 = shiftYears(aujourdhui, -1);
  const debutR12 = monthStart(r12[0]);
  const finR12 = monthEnd(moisRef);
  const finR12n1 = monthEnd(r12n1[r12n1.length - 1]);
  const debutR12n1 = monthStart(r12n1[0]);

  const [
    carnetRows, carnetN1Rows, delaiRows, annulRows, nonAttribueRows, pagesOpp, requetesOpp, snapshotSeo,
  ] = await Promise.all([
    rev.aggregate([
      { $match: { $and: [
        { partner: 'booking', checkOutDateStr: { $gt: aujourdhui } },
        NON_ANNULE,
      ] } },
      { $group: {
        _id: { $substrBytes: ['$checkOutDateStr', 0, 7] },
        montant: { $sum: '$commissionActual' },
        commandes: { $sum: 1 },
      } },
      { $sort: { _id: 1 } },
    ]).toArray(),

    rev.aggregate([
      { $match: { $and: [
        {
          partner: 'booking',
          checkOutDateStr: { $gt: aujourdhuiN1 },
          bookingDateStr: { $lte: aujourdhuiN1 },
        },
        NON_ANNULE,
      ] } },
      { $group: { _id: null, montant: { $sum: '$commissionActual' }, commandes: { $sum: 1 } } },
    ]).toArray(),

    rev.aggregate([
      ETAPE_DATE_PROMESSE,
      { $match: { $and: [
        { _d: { $gte: debutR12, $lte: finR12 }, bookingDateStr: { $gt: null } },
        NON_ANNULE,
      ] } },
      { $addFields: {
        _delai: { $dateDiff: {
          startDate: { $toDate: '$bookingDateStr' },
          endDate: { $toDate: '$dateStr' },
          unit: 'day',
        } },
      } },
      { $group: {
        _id: '$partner',
        commandes: { $sum: 1 },
        moyen: { $avg: '$_delai' },
        j0_7: { $sum: { $cond: [{ $lte: ['$_delai', 7] }, 1, 0] } },
        j8_30: { $sum: { $cond: [{ $and: [{ $gt: ['$_delai', 7] }, { $lte: ['$_delai', 30] }] }, 1, 0] } },
        j31_90: { $sum: { $cond: [{ $and: [{ $gt: ['$_delai', 30] }, { $lte: ['$_delai', 90] }] }, 1, 0] } },
        j91_180: { $sum: { $cond: [{ $and: [{ $gt: ['$_delai', 90] }, { $lte: ['$_delai', 180] }] }, 1, 0] } },
        j181_plus: { $sum: { $cond: [{ $gt: ['$_delai', 180] }, 1, 0] } },
      } },
    ]).toArray(),

    // Annulations : PAS de filtre non-annulé, on compte les deux fenêtres d'un coup.
    rev.aggregate([
      ETAPE_DATE_PROMESSE,
      { $match: { _d: { $gte: debutR12n1, $lte: finR12 } } },
      { $addFields: {
        _fenetre: { $cond: [{ $lte: ['$_d', finR12n1] }, 'n1', 'courant'] },
        _annule: { $regexMatch: { input: { $ifNull: ['$status', ''] }, regex: /cancel/i } },
      } },
      { $group: {
        _id: { partner: '$partner', fenetre: '$_fenetre' },
        commandes: { $sum: 1 },
        annulees: { $sum: { $cond: ['$_annule', 1, 0] } },
        montantPerdu: {
          $sum: { $cond: ['$_annule', { $ifNull: ['$commissionMin', '$commissionActual'] }, 0] },
        },
      } },
    ]).toArray(),

    rev.aggregate([
      ETAPE_DATE_PROMESSE,
      { $match: { $and: [
        { _d: { $gte: debutR12, $lte: finR12 } },
        NON_ANNULE,
        { $or: [{ siteName: { $exists: false } }, { siteName: null }, { siteName: '' }] },
      ] } },
      { $addFields: {
        _cle: { $cond: [
          { $eq: ['$partner', 'sendowl'] },
          { $ifNull: ['$productName', '(inconnu)'] },
          { $ifNull: ['$affiliateId', '(inconnu)'] },
        ] },
      } },
      { $group: {
        _id: { partner: '$partner', cle: '$_cle' },
        montant: { $sum: '$commissionActual' },
        commandes: { $sum: 1 },
      } },
      { $sort: { montant: -1 } },
    ]).toArray(),

    db.collection('gsc_pages')
      .find({ impressions: { $gte: 500 }, ctr: { $lte: 0.03 } })
      .sort({ impressions: -1 }).limit(25).toArray(),

    db.collection('gsc_queries')
      .find({ impressions: { $gte: 300 }, position: { $gte: 5, $lte: 20 } })
      .sort({ impressions: -1 }).limit(25).toArray(),

    db.collection('gsc_pages').aggregate([
      { $group: { _id: null, debut: { $min: '$periodStart' }, fin: { $max: '$periodEnd' } } },
    ]).toArray(),

  ]);

  const carnetTotal = carnetRows.reduce((s, r) => s + Number(r.montant ?? 0), 0);
  const carnetCommandes = carnetRows.reduce((s, r) => s + Number(r.commandes ?? 0), 0);
  const carnetN1Total = Number(carnetN1Rows[0]?.montant ?? 0);
  const carnet: CarnetCommandes = {
    a_date: aujourdhui,
    total: r0(carnetTotal),
    commandes: carnetCommandes,
    par_mois_encaissement: carnetRows.map((r) => ({
      mois: String(r._id),
      montant: r0(Number(r.montant ?? 0)),
      commandes: Number(r.commandes ?? 0),
    })),
    total_n1: r0(carnetN1Total),
    commandes_n1: Number(carnetN1Rows[0]?.commandes ?? 0),
    evolution_pct: evo(carnetTotal, carnetN1Total),
  };

  const delai_reservation: DelaiReservation[] = delaiRows.map((r) => ({
    partenaire: r._id as AffiliationPartner,
    commandes: Number(r.commandes ?? 0),
    jours_moyen: r.moyen != null ? r1(Number(r.moyen)) : null,
    distribution: {
      '0_7_jours': Number(r.j0_7 ?? 0),
      '8_30_jours': Number(r.j8_30 ?? 0),
      '31_90_jours': Number(r.j31_90 ?? 0),
      '91_180_jours': Number(r.j91_180 ?? 0),
      'plus_180_jours': Number(r.j181_plus ?? 0),
    },
  })).sort((a, b) => b.commandes - a.commandes);

  const annulParCle = new Map<string, { commandes: number; annulees: number; montantPerdu: number }>();
  for (const r of annulRows) {
    const { partner, fenetre } = r._id as { partner: AffiliationPartner; fenetre: string };
    annulParCle.set(`${partner}|${fenetre}`, {
      commandes: Number(r.commandes ?? 0),
      annulees: Number(r.annulees ?? 0),
      montantPerdu: Number(r.montantPerdu ?? 0),
    });
  }
  const annulations: Annulations[] = PARTENAIRES.map((p) => {
    const cur = annulParCle.get(`${p}|courant`);
    const prev = annulParCle.get(`${p}|n1`);
    return {
      partenaire: p,
      commandes_totales: cur?.commandes ?? 0,
      commandes_annulees: cur?.annulees ?? 0,
      taux_pct: cur ? part(cur.annulees, cur.commandes) : null,
      montant_perdu: r0(cur?.montantPerdu ?? 0),
      taux_pct_n1: prev ? part(prev.annulees, prev.commandes) : null,
    };
  }).filter((a) => a.commandes_totales > 0 || a.taux_pct_n1 !== null);

  const nonAttribueMontant = nonAttribueRows.reduce((s, r) => s + Number(r.montant ?? 0), 0);
  const nonAttribueCommandes = nonAttribueRows.reduce((s, r) => s + Number(r.commandes ?? 0), 0);

  /* ── 9. Concentration (sur les 12 mois glissants) ─────────────────────── */
  const totalR12 = cumule(r12);
  const parSiteR12 = sitesTries
    .map((site) => ({ site, montant: r0(cumuleSite(site, r12).promesses) }))
    .filter((r) => r.montant > 0)
    .sort((a, b) => b.montant - a.montant);
  const basePromesses = totalR12.promesses;
  const hhi = (montants: number[]) => {
    if (basePromesses <= 0) return null;
    return r0(montants.reduce((s, m) => s + Math.pow((m / basePromesses) * 100, 2), 0));
  };
  const concentration: Concentration = {
    par_site: parSiteR12.map((r) => ({ ...r, part_pct: part(r.montant, basePromesses) })),
    par_partenaire: PARTENAIRES
      .map((p) => ({ partenaire: p, montant: r0(totalR12.parPartenaire.get(p) ?? 0) }))
      .filter((r) => r.montant > 0)
      .sort((a, b) => b.montant - a.montant)
      .map((r) => ({ ...r, part_pct: part(r.montant, basePromesses) })),
    part_top1_site_pct: parSiteR12[0] ? part(parSiteR12[0].montant, basePromesses) : null,
    part_top3_sites_pct: part(
      parSiteR12.slice(0, 3).reduce((s, r) => s + r.montant, 0), basePromesses,
    ),
    part_top1_partenaire_pct: part(
      Math.max(0, ...PARTENAIRES.map((p) => totalR12.parPartenaire.get(p) ?? 0)), basePromesses,
    ),
    hhi_sites: hhi(parSiteR12.map((r) => r.montant)),
    hhi_partenaires: hhi(PARTENAIRES.map((p) => totalR12.parPartenaire.get(p) ?? 0)),
  };

  /* ── 10. Saisonnalité — index 100 = mois moyen de l'année ─────────────── */
  const anneesCompletes: number[] = [];
  const anneesCandidates = [...new Set(axe.map((m) => Number(m.slice(0, 4))))].sort();
  for (const annee of anneesCandidates) {
    const moisAnnee = Array.from({ length: 12 }, (_, i) => `${annee}-${String(i + 1).padStart(2, '0')}`);
    const toutPresent = moisAnnee.every((m) => axe.includes(m) && !moisIncomplets.revenus.includes(m));
    if (toutPresent) anneesCompletes.push(annee);
  }
  const indexParMois = Array.from({ length: 12 }, (_, i) => {
    const moisCal = i + 1;
    const valeurs: number[] = [];
    for (const annee of anneesCompletes) {
      const moisAnnee = Array.from({ length: 12 }, (_, j) => `${annee}-${String(j + 1).padStart(2, '0')}`);
      const totalAnnee = moisAnnee.reduce((s, m) => s + (parMois.get(m)?.promesses ?? 0), 0);
      if (totalAnnee <= 0) continue;
      const mois = `${annee}-${String(moisCal).padStart(2, '0')}`;
      valeurs.push(((parMois.get(mois)?.promesses ?? 0) / (totalAnnee / 12)) * 100);
    }
    return {
      mois_calendaire: moisCal,
      index: valeurs.length ? r0(valeurs.reduce((s, v) => s + v, 0) / valeurs.length) : null,
    };
  });

  /* ── 11. Leviers SEO (instantané, pas d'historique disponible) ────────── */
  const versLevier = (d: Record<string, unknown>, champCible: 'page' | 'query'): LevierSeo => ({
    site: String(d.shortName ?? d.siteName ?? '?'),
    cible: String(d[champCible] ?? ''),
    impressions: Number(d.impressions ?? 0),
    clics: Number(d.clicks ?? 0),
    ctr_pct: d.ctr != null ? r1(Number(d.ctr) * 100) : null,
    position: d.position != null ? r1(Number(d.position)) : null,
  });

  const snapDebut = snapshotSeo[0]?.debut ? new Date(snapshotSeo[0].debut).toISOString().slice(0, 10) : null;
  const snapFin = snapshotSeo[0]?.fin ? new Date(snapshotSeo[0].fin).toISOString().slice(0, 10) : null;

  /* ── 11 bis. Production éditoriale et contexte externe ────────────────── */
  const moisEditoTries = [...moisAvecEdito].sort();
  const productionEditoriale: ProductionEditoriale = {
    couverture: {
      premiere_semaine: moisEditoTries[0] ? monthStart(moisEditoTries[0]) : null,
      derniere_semaine: moisEditoTries.length ? monthEnd(moisEditoTries[moisEditoTries.length - 1]) : null,
      avertissement:
        'Le suivi éditorial ne couvre que les mois listés : ailleurs, la production vaut « inconnue », jamais zéro. Les compteurs sont des articles nouveaux (New) et mis à jour (MAJ), saisis à la main par semaine. « Articles produits » = le travail de rédaction, compté une fois ; « publications » = le même article compté sur chaque site qui le porte (les destinations listées dans destinations_dupliquees sont publiées à l\'identique sur plusieurs sites). Le chiffre par site est un nombre de publications.',
    },
    mensuel_groupe: moisEditoTries.map((mois) => ({
      mois,
      articles_produits_nouveaux: editoProduitsParMois.get(mois)?.nouveaux ?? 0,
      articles_produits_maj: editoProduitsParMois.get(mois)?.majs ?? 0,
      publications_nouveaux: editoPublicationsParMois.get(mois)?.nouveaux ?? 0,
      publications_maj: editoPublicationsParMois.get(mois)?.majs ?? 0,
    })),
    destinations_dupliquees: [...editoDupliquees].sort(),
    non_rattachees: [...editoNonRattachees.entries()]
      .map(([destination, v]) => ({ destination, articles_nouveaux: v.nouveaux, articles_maj: v.majs }))
      .sort((a, b) => b.articles_nouveaux - a.articles_nouveaux),
    stock_par_site: [...stockParSite.entries()].map(([site, v]) => {
      const ant = stockAnterieurParDestination.get(v.destination);
      return {
        site,
        destination: v.destination,
        date: v.date,
        publies: v.publies,
        reste_a_maj: v.resteAMaj,
        publies_il_y_a_3_mois: ant?.publies ?? null,
        reste_a_maj_il_y_a_3_mois: ant?.resteAMaj ?? null,
      };
    }).sort((a, b) => a.site.localeCompare(b.site)),
  };

  const contexteExterne: ContexteExterne = {
    derniere_veille: veilleLe,
    avertissement:
      'Faits externes issus d\'une recherche web sourcée, retenus manuellement. Ce sont des HYPOTHÈSES DATÉES, pas des mesures de nos sites : un chiffre marqué « non_transposable » provient d\'un autre corpus et ne doit jamais être appliqué à nos chiffres. Pour juger l\'effet réel d\'un événement, confronter sa date aux séries mensuelles ci-dessus.',
    evenements: evenementsVeille,
  };

  /* ── 12. Avertissements de lecture ────────────────────────────────────── */
  const avertissements: string[] = [
    `Toute lecture de tendance s'arrête à ${moisLisible(moisRef)} : au-delà, au moins une source est incomplète.`,
    'Promesses et réalisé ne sont pas comparables entre eux : les promesses datent de la commande, le réalisé de l\'encaissement (Booking : check-out). Un écart entre les deux est normal, pas un signal.',
    'Le carnet N-1 est net des annulations survenues depuis, alors que le carnet du jour les contient encore : à volume égal, la comparaison surestime légèrement le carnet actuel.',
    'Les leviers SEO sont un instantané 30 jours rafraîchi seulement lors d\'une synchronisation « full » : aucune tendance ne peut en être tirée.',
    'Le nombre de commandes est un compte de lignes d\'import : une même réservation modifiée peut apparaître plusieurs fois selon le partenaire.',
  ];
  /* Un site qui reçoit des sessions sans jamais remonter de clic sortant a presque
   * toujours un événement GA4 mal nommé, pas un entonnoir réellement vide : l'ingestion
   * filtre sur un nom exact et renvoie zéro sans erreur si le nom ne correspond pas. */
  const sansClicSortant = entonnoir
    .filter((e) => e.courant.sessions > 0 && e.courant.clics_sortants === 0)
    .map((e) => `${e.site} (événement configuré : ${siteMeta.get(e.site)?.linkEvent ?? '?'})`);
  if (sansClicSortant.length > 0) {
    avertissements.push(
      `Aucun clic sortant mesuré malgré des sessions sur : ${sansClicSortant.join(', ')}. ` +
      'Leur entonnoir est inexploitable en aval des sessions, et leurs taux de conversion ne doivent pas être commentés.',
    );
  }

  const definitions = new Set(sites.filter((s) => s.active).map((s) => s.linkEvent));
  if (definitions.size > 1) {
    avertissements.push(
      `Les clics sortants ne reposent pas sur la même définition partout (${[...definitions].join(', ')}) : ` +
      'l\'événement automatique « click » compte tous les liens sortants, un événement personnalisé ne compte que les liens affiliés. ' +
      'Les taux de clic sortant ne sont comparables qu\'entre sites partageant la même définition.',
    );
  }

  if (contexteEnregistre.champs_non_renseignes.length > 0) {
    avertissements.push(
      `Contexte métier incomplet (${contexteEnregistre.champs_non_renseignes.join(', ')}) : ne rien supposer sur ces points, et le signaler une fois plutôt que d'inventer un objectif.`,
    );
  }
  if (nonAttribueMontant > 0) {
    const p = part(nonAttribueMontant, basePromesses);
    avertissements.push(
      `${r0(nonAttribueMontant)} € de commissions sur 12 mois ne sont rattachés à aucun site${p !== null ? ` (${p} % du total)` : ''} : les analyses par site portent sur le reste.`,
    );
  }
  for (const f of fraicheurParPartenaire) {
    if (f.commandes_en_base > 0 && f.dernier_jour_commande && f.dernier_jour_commande < monthStart(moisCourant)) {
      avertissements.push(
        `Import ${f.partenaire} en retard : dernière commande connue le ${f.dernier_jour_commande}.`,
      );
    }
  }

  return {
    meta: {
      genere_le: new Date().toISOString(),
      aujourdhui,
      dernier_mois_complet: moisRef,
      nb_mois_series_groupe: MOIS_GROUPE,
      nb_mois_series_site: MOIS_PAR_SITE,
      lecture:
        'Montants en euros. Taux et parts en pourcentage (déjà ×100). « Promesses » = commission à la date de commande ; « réalisé » = commission à la date d\'encaissement. RPM = promesses pour 1 000 sessions.',
    },
    contexte_metier: {
      ...contexteEnregistre.contexte,
      champs_non_renseignes: contexteEnregistre.champs_non_renseignes,
      modifie_le: contexteEnregistre.modifie_le,
    },
    fiabilite: {
      derniere_donnee: {
        trafic_ga4: dernierJourTrafic,
        seo_gsc: dernierJourGsc,
        revenus_par_partenaire: fraicheurParPartenaire,
      },
      dernier_mois_complet: moisRef,
      mois_incomplets: moisIncomplets,
      revenu_non_attribue: {
        montant: r0(nonAttribueMontant),
        commandes: nonAttribueCommandes,
        part_du_revenu_pct: part(nonAttribueMontant, basePromesses),
      },
      cles_affiliation_non_mappees: nonAttribueRows.slice(0, 10).map((r) => {
        const id = r._id as { partner: AffiliationPartner; cle: string };
        return {
          partenaire: id.partner,
          cle: id.cle,
          montant: r0(Number(r.montant ?? 0)),
          commandes: Number(r.commandes ?? 0),
        };
      }),
      avertissements,
    },
    sites: sites
      .map((s) => {
        const renseignes = PARTENAIRES.filter((p) => !codesManquants(s).includes(p) && p !== 'sendowl');
        return {
          site: s.shortName,
          nom_complet: s.name,
          actif: s.active,
          premier_mois_trafic: premierMoisParSite.get(s.shortName) ?? null,
          evenement_clic_sortant: s.linkEvent,
          codes_affiliation_renseignes: renseignes,
          codes_affiliation_manquants: codesManquants(s),
        };
      })
      .sort((a, b) => a.site.localeCompare(b.site)),
    serie_mensuelle_groupe: serieGroupe,
    serie_mensuelle_par_site: serieParSite,
    comparables: {
      rolling12: kR12,
      rolling12_n1: kR12n1,
      ytd: kYtd,
      ytd_n1: kYtdN1,
      ytd_n2: kYtdN2,
      evolutions_pct: {
        rolling12_vs_n1: evolutions(kR12, kR12n1),
        ytd_vs_n1: evolutions(kYtd, kYtdN1),
      },
    },
    entonnoir_par_site: entonnoir,
    production_editoriale: productionEditoriale,
    contexte_externe: contexteExterne,
    carnet,
    delai_reservation,
    annulations,
    concentration,
    saisonnalite: {
      annees_utilisees: anneesCompletes,
      index_par_mois_calendaire: indexParMois,
    },
    leviers_seo: {
      instantane: {
        debut: snapDebut,
        fin: snapFin,
        avertissement:
          'Instantané agrégé sur ~30 jours, réécrit à chaque synchronisation « full ». Aucune profondeur historique : ne jamais en déduire une évolution.',
      },
      pages_fortes_impressions_faible_ctr: pagesOpp.map((d) => versLevier(d, 'page')),
      requetes_a_portee: requetesOpp.map((d) => versLevier(d, 'query')),
    },
    actions_precedentes: opts.actionsPrecedentes ?? [],
  };
}
