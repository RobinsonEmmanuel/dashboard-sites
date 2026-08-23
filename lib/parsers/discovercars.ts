import type { AffiliationRevenue } from '../models/revenue';
import { DISCOVERCARS_CHANNEL_MAP } from '../mappings/discovercars-channels';
import { parseCsv, normalizeDate, parseAmount } from './csv-utils';
import { stableFallbackOrderId } from './stable-import-id';
import { tauxUsdEur } from '../rates/usd-eur';

export interface ParseResult {
  records: Omit<AffiliationRevenue, '_id'>[];
  skipped: number;
  errors: string[];
}

export interface DiscoverCarsOptions {
  /** Taux USD→EUR pour les mois absents de la table figée (mois à venir). */
  tauxSupplement?: Record<string, number>;
  /** Domaines de nos sites, pour distinguer un référent tiers d'un des nôtres. */
  domainesConnus?: string[];
}

/**
 * DiscoverCars CSV parser.
 *
 * Colonnes exploitées : Created, Your Commission, Order ID, Channel name, Product ID,
 * Status, Country Code, Extra Data 3 (lieu de location), Last click referrer.
 *
 * Trois points de vigilance appris de l'historique :
 *
 * 1. DEVISE. DiscoverCars publie ses commissions en DOLLARS. Elles étaient jusqu'ici
 *    additionnées comme des euros, ce qui surévaluait la ligne d'environ 9 %. La
 *    conversion se fait au taux BCE du 1er du mois de la commande — le partenaire règle
 *    une fois par mois — et le montant d'origine comme le taux sont conservés.
 *
 * 2. STATUT. Le champ vaut « A » (approuvé), « P » (en attente) ou « D » (refusé). Un
 *    filtre cherchant « cancel » ne reconnaît aucune de ces valeurs : 17 % du revenu
 *    historique était donc compté comme acquis alors qu'il est refusé. Les statuts sont
 *    normalisés en libellés que les agrégations existantes savent exclure.
 *
 * 3. CANAL. La casse des canaux diverge entre l'export et les fiches sites
 *    (« Madeira » contre « madeira »), ce qui faisait échouer des rattachements
 *    pourtant corrects. La résolution est donc insensible à la casse.
 */
export function parseDiscoverCarsCsv(
  text: string,
  siteMap?: Record<string, string>,
  options: DiscoverCarsOptions = {},
): ParseResult {
  const rows = parseCsv(text);
  const records: Omit<AffiliationRevenue, '_id'>[] = [];
  let skipped = 0;
  const errors: string[] = [];

  const carte = siteMap ?? DISCOVERCARS_CHANNEL_MAP;
  /* Index en minuscules : la casse des canaux n'est pas fiable côté partenaire. */
  const carteInsensible = new Map(
    Object.entries(carte).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  const resoudreCanal = (canal: string): string | undefined =>
    canal ? carte[canal] ?? carteInsensible.get(canal.trim().toLowerCase()) : undefined;

  const nosDomaines = new Set((options.domainesConnus ?? []).map((d) => normaliserDomaine(d)));

  let approximations = 0;

  for (const row of rows) {
    const keys = Object.keys(row);
    const get = (name: string) => {
      const key = keys.find((k) => k.toLowerCase().includes(name.toLowerCase()));
      return key ? row[key] : '';
    };
    const getExact = (target: string) => {
      const key = keys.find((k) => k.toLowerCase().trim() === target.toLowerCase());
      return key ? row[key] : '';
    };

    const dateRaw = get('created') || get('booking date') || get('date');
    const dateStr = normalizeDate(dateRaw);
    if (!dateStr) {
      if (dateRaw) errors.push(`Date invalide : ${dateRaw}`);
      continue;
    }

    const commissionUsd = parseAmount(get('your commission') || get('commission'));
    if (commissionUsd <= 0) {
      skipped++;
      continue;
    }

    /* Conversion au taux du 1er du mois de la commande. */
    const mois = dateStr.slice(0, 7);
    const { taux, approxime } = tauxUsdEur(mois, options.tauxSupplement);
    if (approxime) approximations++;
    const commissionEur = Math.round(commissionUsd * taux * 1e6) / 1e6;

    const status = normaliserStatut(getExact('Status') || get('status'));

    const canal = (get('channel name') || get('channel') || '').trim();
    const siteName = resoudreCanal(canal);

    const pays = (getExact('Country Code') || get('country code') || get('country') || '').trim().toUpperCase();
    const lieu = extraireLieu(getExact('Extra Data 3') || get('extra data 3'));
    const referent = normaliserDomaine(getExact('Last click referrer') || get('last click referrer'));

    /* Référent tiers : le revenu vient d'un sous-affilié, aucun de nos sites ne l'a
     * généré. Ne jamais l'estimer — ce serait attribuer à ZigZag le travail d'un autre.
     * Ne se pose que faute de canal : un canal renseigné rattache déjà la ligne. */
    const sousAffilie =
      !siteName && referent && !nosDomaines.has(referent)
        && !referent.includes('discovercars')
        && !EXCLUS_REFERENT.some((e) => referent.includes(e))
        ? referent
        : undefined;

    let siteNameEstime: string | undefined;
    let methodeEstimation: string | undefined;
    if (!siteName && !sousAffilie) {
      const estimation = estimerCanal(pays, lieu);
      if (estimation) {
        siteNameEstime = resoudreCanal(estimation.canal);
        methodeEstimation = estimation.methode;
      }
    }

    const carLabel = (get('product id') || get('car model') || get('product') || '').trim();
    const rawOrderId = (getExact('Order ID') || get('order id') || get('booking id') || '').trim();
    const reservationCountry = pays || undefined;

    const orderId =
      (getExact('ID') || '').trim() ||
      rawOrderId ||
      stableFallbackOrderId('dc-fp-', [dateStr, canal, String(commissionUsd), carLabel, lieu ?? '']);

    records.push({
      partner: 'discovercars',
      date: new Date(dateStr),
      dateStr,
      orderId,
      affiliateId: canal || undefined,
      productName: carLabel || undefined,
      commissionActual: commissionEur,
      commissionSource: commissionUsd,
      deviseSource: 'USD',
      tauxChange: taux,
      tauxApproxime: approxime || undefined,
      siteName,
      siteNameEstime,
      methodeEstimation,
      sousAffilieDomaine: sousAffilie,
      lieuLocation: lieu,
      reservationCountry,
      status,
      importedAt: new Date(),
    });
  }

  if (approximations > 0) {
    errors.push(
      `${approximations} ligne(s) converties avec un taux approché : le mois de la commande n'est pas dans la table des taux. Compléter lib/rates/usd-eur.ts.`,
    );
  }

  return { records, skipped, errors };
}

/** Référents qui n'identifient pas un site : moteurs, réseaux, agrégateurs de cashback. */
const EXCLUS_REFERENT = ['google.', 'facebook.', 'instagram.', 'bing.', 'duckduckgo', 'joko', 'yahoo.', 't.co'];

/**
 * Statuts DiscoverCars → libellés que les agrégations savent lire. « cancelled » est
 * choisi parce que les filtres existants excluent le revenu par `/cancel/i` : les lignes
 * refusées sortent donc du revenu sans qu'aucune requête n'ait à changer, tout en restant
 * comptabilisables comme annulations.
 */
function normaliserStatut(brut: string): string | undefined {
  const s = (brut ?? '').trim().toUpperCase();
  if (!s) return undefined;
  if (s === 'D' || s.includes('DECLIN') || s.includes('CANCEL') || s.includes('REFUND')) return 'cancelled';
  if (s === 'P' || s.includes('PEND')) return 'pending';
  if (s === 'A' || s.includes('APPROV')) return 'approved';
  return brut.trim();
}

/** « Location: Spain - Canary Islands, Lanzarote, Lanzarote Airport (ACE) » → sans le préfixe. */
function extraireLieu(brut: string): string | undefined {
  const t = (brut ?? '').trim();
  if (!t) return undefined;
  return t.replace(/^location\s*:\s*/i, '').trim() || undefined;
}

/** Accepte aussi bien une URL complète qu'un domaine nu — les deux formes circulent :
 *  l'export donne des URLs, la fiche site un domaine. */
function normaliserDomaine(valeur: string): string {
  const t = (valeur ?? '').trim();
  if (!t) return '';
  const sansProtocole = t.replace(/^https?:\/\//i, '');
  const hote = sansProtocole.split(/[/?#]/)[0].replace(/^www\./i, '');
  return hote.includes('.') ? hote.toLowerCase() : '';
}

/**
 * Attribution de repli quand le canal est absent, reprise de la feuille de calcul
 * historique : le pays de l'utilisateur sert d'indice de langue, donc de site
 * généraliste. Deux corrections par rapport à la formule d'origine :
 *
 *   - « AU » y envoyait vers le site allemand. AU est l'AUSTRALIE ; l'Autriche est AT.
 *     Les locations concernées se font au Portugal, en France, en Grèce ou en
 *     Nouvelle-Zélande : ce sont des Australiens en voyage, pas des germanophones.
 *   - le cas Madère renvoyait « ML », qui n'existe pas côté DiscoverCars. Le canal
 *     réellement utilisé est « Madeira ».
 *
 * Cette estimation ne peut désigner qu'un site généraliste : elle ne saura jamais
 * attribuer à un site de destination. C'est pourquoi elle vit dans un champ séparé.
 */
function estimerCanal(pays: string, lieu?: string): { canal: string; methode: string } | null {
  const h = (lieu ?? '').toLowerCase();

  if (['FR', 'BE', 'LU', 'CH'].includes(pays)) {
    return { canal: 'ZV', methode: `pays=${pays} → site francophone` };
  }
  if (['DE', 'AT'].includes(pays)) {
    return { canal: 'ZR', methode: `pays=${pays} → site germanophone` };
  }
  if (['ES', 'MX', 'AR', 'CO', 'CL', 'PE'].includes(pays)) {
    return { canal: 'ZE', methode: `pays=${pays} → site hispanophone` };
  }
  if (pays === 'PT' && ['madere', 'madeira', 'funchal'].some((k) => h.includes(k))) {
    return { canal: 'Madeira', methode: 'pays=PT et location à Madère' };
  }
  if (!pays) return null; // Sans pays, aucune estimation défendable.
  return { canal: 'ZZOE', methode: `pays=${pays} → site anglophone par défaut` };
}

/** Détection : le CSV DiscoverCars contient "Channel name" et "Your Commission" */
export function isDiscoverCarsCsv(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase());
  return h.some((x) => x.includes('channel name')) && h.some((x) => x.includes('your commission'));
}
