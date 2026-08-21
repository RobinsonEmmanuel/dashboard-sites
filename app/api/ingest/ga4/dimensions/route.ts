/**
 * GET /api/ingest/ga4/dimensions
 *
 * Inventaire des dimensions personnalisées par propriété GA4, et surtout : test que la
 * dimension utile est réellement ALIMENTÉE.
 *
 * Deux conditions doivent être remplies pour ventiler les clics sortants par partenaire,
 * et une seule des deux se voit dans l'interface GA4 :
 *   1. la dimension personnalisée existe sur le paramètre `exit_link_domain` — visible
 *      dans Admin → Définitions personnalisées ;
 *   2. la balise de clic sortant envoie effectivement ce paramètre — invisible sans
 *      ouvrir GTM, ou sans interroger les données.
 *
 * Une dimension déclarée mais non alimentée renvoie des lignes vides sans erreur. Cette
 * route fait donc les deux : elle lit les définitions via l'API Admin, puis interroge
 * l'API Data pour afficher les domaines réellement collectés, avec leur volume.
 *
 * Le verdict est porté par la SECONDE vérification, pas la première : interroger les
 * données prouve à la fois que la dimension existe et qu'elle est alimentée, alors que
 * l'inventaire ne prouve que son existence. L'API Admin ne sert donc qu'à enrichir la
 * réponse, et son indisponibilité — elle s'active séparément dans Google Cloud — ne
 * bloque pas le diagnostic.
 *
 * Rappel : une dimension personnalisée n'est PAS rétroactive. Elle doit être créée avant
 * que les données ne soient utiles, pas au moment où on en a besoin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { getGoogleAccessToken } from '@/lib/google-auth';
import type { Site } from '@/lib/models/site';

const GA4_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

/** Le paramètre qui porte le domaine de destination du clic sortant. */
const PARAMETRE_CIBLE = 'exit_link_domain';

/**
 * Repli : si le domaine n'est pas envoyé mais l'URL complète l'est, le domaine s'en
 * déduit en code. Cardinalité énorme côté GA4, mais on n'agrège que le domaine, donc
 * une requête sur les valeurs les plus fréquentes suffit à établir que la donnée existe.
 */
const PARAMETRE_REPLI = 'exit_link_url';

/**
 * L'événement automatique de GA4 dispose d'une dimension `linkDomain` NATIVE, sans
 * aucune configuration. Pour ces sites, envoyer l'utilisateur corriger un conteneur GTM
 * serait un contresens : il n'y a rien à configurer.
 */
const EVENEMENT_GENERIQUE = 'click';
const DIMENSION_NATIVE = 'linkDomain';

interface DimensionGa4 {
  nom_affiche: string;
  parametre: string;
  portee: string;
}

async function dimensionsDeLaPropriete(propertyId: string, token: string): Promise<DimensionGa4[]> {
  const res = await fetch(
    `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/customDimensions`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const texte = await res.text();
    throw new Error(`Admin API ${res.status}: ${texte.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    customDimensions?: Array<{ displayName?: string; parameterName?: string; scope?: string }>;
  };
  return (data.customDimensions ?? []).map((d) => ({
    nom_affiche: d.displayName ?? '',
    parametre: d.parameterName ?? '',
    portee: d.scope ?? '',
  }));
}

type ResultatSonde =
  | { etat: 'valeurs'; domaines: Array<{ domaine: string; evenements: number }> }
  | { etat: 'dimension_inconnue' }
  | { etat: 'erreur'; message: string };

/** Une dimension non enregistrée fait échouer la requête avec un message identifiable. */
const DIMENSION_INCONNUE = /not a valid dimension|did not match|Field .* is not/i;

/** Valeurs réellement collectées : le seul test qui prouve que la balise envoie le paramètre. */
async function sonder(
  propertyId: string,
  token: string,
  evenement: string,
  dimensionApi: string,
  jours: number,
): Promise<ResultatSonde> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${jours}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: dimensionApi }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', stringFilter: { value: evenement, matchType: 'EXACT' } },
        },
        orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
        limit: 15,
      }),
    },
  );
  if (!res.ok) {
    const texte = await res.text();
    if (DIMENSION_INCONNUE.test(texte)) return { etat: 'dimension_inconnue' };
    return { etat: 'erreur', message: `Data API ${res.status}: ${texte.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
  };
  return {
    etat: 'valeurs',
    domaines: (data.rows ?? []).map((r) => ({
      domaine: r.dimensionValues[0]?.value ?? '',
      evenements: Number(r.metricValues[0]?.value ?? 0),
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jours = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10), 1), 365);

    const token = await getGoogleAccessToken(GA4_SCOPES);
    const db = await getDatabase();
    const sites = await db.collection<Site>('sites')
      .find({ active: true }).sort({ name: 1 }).toArray();

    const diagnostics = await Promise.all(sites.map(async (site) => {
      const base = {
        site: site.shortName,
        nom: site.name,
        propertyId: site.ga4PropertyId,
        evenement_clic_sortant: site.linkEvent,
      };

      if (!site.ga4PropertyId) {
        return { ...base, statut: 'sans_propriete' as const, dimensions: [], inventaireIndisponible: null, source: null, domaines: [], correction: 'Aucun Property ID sur la fiche du site.' };
      }

      /* L'inventaire est un complément : son échec (API Admin non activée dans le
       * projet Google Cloud) ne doit pas empêcher le diagnostic. */
      let dimensions: DimensionGa4[] = [];
      let inventaireIndisponible: string | null = null;
      try {
        dimensions = await dimensionsDeLaPropriete(site.ga4PropertyId, token);
      } catch (e) {
        inventaireIndisponible = e instanceof Error ? e.message : String(e);
      }

      const commun = { ...base, dimensions, inventaireIndisponible };

      const renseignees = (r: ResultatSonde) =>
        r.etat === 'valeurs' ? r.domaines.filter((d) => d.domaine && d.domaine !== '(not set)') : [];
      const volumeTotal = (r: ResultatSonde) =>
        r.etat === 'valeurs' ? r.domaines.reduce((acc, d) => acc + d.evenements, 0) : 0;
      const partVide = (r: ResultatSonde) => {
        const total = volumeTotal(r);
        if (total === 0) return null;
        const utiles = renseignees(r).reduce((acc, d) => acc + d.evenements, 0);
        return Math.round(((total - utiles) / total) * 1000) / 10;
      };

      /* Site sur l'événement automatique : la dimension native est la bonne source, et
       * elle ne demande aucune configuration. Ne jamais renvoyer ces sites vers GTM. */
      if (site.linkEvent === EVENEMENT_GENERIQUE) {
        const natif = await sonder(site.ga4PropertyId, token, EVENEMENT_GENERIQUE, DIMENSION_NATIVE, jours);
        if (natif.etat === 'erreur') {
          return { ...commun, statut: 'erreur' as const, source: null, domaines: [], correction: natif.message };
        }
        const utiles = renseignees(natif);
        if (utiles.length > 0) {
          return {
            ...commun,
            statut: 'ok_natif' as const,
            source: DIMENSION_NATIVE,
            domaines: utiles,
            part_non_renseignee_pct: partVide(natif),
            correction: 'Rien à configurer : le domaine vient de la dimension native de GA4. Attention, « click » compte tous les liens sortants, donc la ventilation inclura des domaines non partenaires.',
          };
        }
        return {
          ...commun,
          statut: 'natif_vide' as const,
          source: DIMENSION_NATIVE,
          domaines: natif.etat === 'valeurs' ? natif.domaines : [],
          correction: `La dimension native « ${DIMENSION_NATIVE} » ne renvoie aucun domaine sur ${jours} jours. Vérifier que « Clics sortants » est bien activé dans la mesure améliorée du flux de données.`,
        };
      }

      /* Site sur un événement dédié : le paramètre attendu, puis son repli. */
      const cible = await sonder(site.ga4PropertyId, token, site.linkEvent, `customEvent:${PARAMETRE_CIBLE}`, jours);
      if (cible.etat === 'erreur') {
        return { ...commun, statut: 'erreur' as const, source: null, domaines: [], correction: cible.message };
      }

      const utilesCible = renseignees(cible);
      if (utilesCible.length > 0) {
        return {
          ...commun,
          statut: 'ok' as const,
          source: PARAMETRE_CIBLE,
          domaines: utilesCible,
          part_non_renseignee_pct: partVide(cible),
          correction: null,
        };
      }

      /* Avant d'envoyer qui que ce soit modifier un conteneur GTM : l'URL complète
       * suffit, le domaine s'en extrait. Un chantier évité s'il est déjà envoyé. */
      const repli = await sonder(site.ga4PropertyId, token, site.linkEvent, `customEvent:${PARAMETRE_REPLI}`, jours);
      const utilesRepli = renseignees(repli);
      if (utilesRepli.length > 0) {
        return {
          ...commun,
          statut: 'ok_via_url' as const,
          source: PARAMETRE_REPLI,
          domaines: utilesRepli,
          part_non_renseignee_pct: partVide(repli),
          correction: `Le domaine n'est pas envoyé, mais l'URL complète l'est : le domaine s'en déduit à l'ingestion, sans toucher au conteneur GTM. Aucune action requise sur ce site.`,
        };
      }

      if (cible.etat === 'dimension_inconnue') {
        return {
          ...commun,
          statut: 'a_creer' as const,
          source: null,
          domaines: [],
          correction: `Créer la dimension : Admin → Définitions personnalisées → Créer, portée « Événement », paramètre « ${PARAMETRE_CIBLE} ». La balise de ce site envoie déjà ce paramètre, donc la mesure fonctionnera dès la création — mais elle n'est PAS rétroactive.`,
        };
      }

      return {
        ...commun,
        statut: 'declaree_non_alimentee' as const,
        source: null,
        domaines: cible.etat === 'valeurs' ? cible.domaines : [],
        correction: `Ni « ${PARAMETRE_CIBLE} » ni « ${PARAMETRE_REPLI} » ne sont alimentés sur ${jours} jours pour l'événement « ${site.linkEvent} ». La balise GTM de ce site n'envoie aucun paramètre de destination : c'est le conteneur qu'il faut compléter, pas GA4.`,
      };
    }));

    return NextResponse.json({
      jours,
      parametre_cible: PARAMETRE_CIBLE,
      resume: {
        ok: diagnostics.filter((d) => d.statut === 'ok').length,
        ok_via_url: diagnostics.filter((d) => d.statut === 'ok_via_url').length,
        ok_natif: diagnostics.filter((d) => d.statut === 'ok_natif').length,
        a_creer: diagnostics.filter((d) => d.statut === 'a_creer').length,
        declaree_non_alimentee: diagnostics.filter((d) => d.statut === 'declaree_non_alimentee').length,
        natif_vide: diagnostics.filter((d) => d.statut === 'natif_vide').length,
        sans_propriete: diagnostics.filter((d) => d.statut === 'sans_propriete').length,
        erreur: diagnostics.filter((d) => d.statut === 'erreur').length,
      },
      /* L'inventaire complet demande l'activation de l'API Admin dans le projet Google
       * Cloud. Le diagnostic fonctionne sans, mais la liste des dimensions reste vide. */
      inventaire_indisponible: diagnostics.some((d) => d.inventaireIndisponible)
        ? 'API Admin non activée : les verdicts restent valides (ils viennent des données), mais la liste des dimensions par propriété est vide. Activer « Google Analytics Admin API » dans le projet Google Cloud pour l\'obtenir.'
        : null,
      diagnostics,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GA4/DIMENSIONS]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
