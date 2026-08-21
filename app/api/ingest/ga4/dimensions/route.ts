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

/** L'événement automatique de GA4 dispose d'une dimension `linkDomain` native. */
const EVENEMENT_GENERIQUE = 'click';

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

/** Valeurs réellement collectées : le seul test qui prouve que la balise envoie le paramètre. */
async function domainesCollectes(
  propertyId: string,
  token: string,
  evenement: string,
  parametre: string,
  jours: number,
): Promise<Array<{ domaine: string; evenements: number }>> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${jours}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: `customEvent:${parametre}` }],
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
    throw new Error(`Data API ${res.status}: ${texte.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
  };
  return (data.rows ?? []).map((r) => ({
    domaine: r.dimensionValues[0]?.value ?? '',
    evenements: Number(r.metricValues[0]?.value ?? 0),
  }));
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
        return { ...base, statut: 'sans_propriete' as const, dimensions: [], domaines: [], correction: 'Aucun Property ID sur la fiche du site.' };
      }

      try {
        const dimensions = await dimensionsDeLaPropriete(site.ga4PropertyId, token);
        const cible = dimensions.find((d) => d.parametre === PARAMETRE_CIBLE);

        if (!cible) {
          // Sur l'événement automatique, GA4 fournit `linkDomain` sans configuration.
          if (site.linkEvent === EVENEMENT_GENERIQUE) {
            return {
              ...base,
              statut: 'dimension_native_possible' as const,
              dimensions, domaines: [],
              correction: `Aucune dimension « ${PARAMETRE_CIBLE} », mais ce site compte l'événement automatique « click » : GA4 expose alors nativement le domaine du lien, sans configuration. Rien à créer ici — à confirmer au moment de brancher l'ingestion.`,
            };
          }
          return {
            ...base,
            statut: 'a_creer' as const,
            dimensions, domaines: [],
            correction: `Créer la dimension : Admin → Définitions personnalisées → Créer, portée « Événement », paramètre « ${PARAMETRE_CIBLE} ». Non rétroactive : les données ne remonteront qu'à partir de sa création.`,
          };
        }

        const domaines = await domainesCollectes(
          site.ga4PropertyId, token, site.linkEvent, PARAMETRE_CIBLE, jours,
        );
        const renseignes = domaines.filter((d) => d.domaine && d.domaine !== '(not set)');
        const total = domaines.reduce((s, d) => s + d.evenements, 0);
        const vides = total - renseignes.reduce((s, d) => s + d.evenements, 0);

        if (renseignes.length === 0) {
          return {
            ...base,
            statut: 'declaree_non_alimentee' as const,
            dimensions, domaines,
            correction: `La dimension existe mais aucune valeur n'est collectée sur ${jours} jours pour l'événement « ${site.linkEvent} ». La balise GTM de ce site n'envoie pas le paramètre « ${PARAMETRE_CIBLE} » : c'est le conteneur qu'il faut corriger, pas GA4.`,
          };
        }

        return {
          ...base,
          statut: 'ok' as const,
          dimensions,
          domaines: renseignes,
          part_non_renseignee_pct: total > 0 ? Math.round((vides / total) * 1000) / 10 : null,
          correction: vides > 0
            ? `${vides} clics sortants sur ${total} n'ont pas de domaine renseigné : la balise ne remplit pas toujours le paramètre. Utilisable, mais la ventilation par partenaire sera incomplète d'autant.`
            : null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ...base, statut: 'erreur' as const, dimensions: [], domaines: [], correction: msg };
      }
    }));

    return NextResponse.json({
      jours,
      parametre_cible: PARAMETRE_CIBLE,
      resume: {
        ok: diagnostics.filter((d) => d.statut === 'ok').length,
        a_creer: diagnostics.filter((d) => d.statut === 'a_creer').length,
        declaree_non_alimentee: diagnostics.filter((d) => d.statut === 'declaree_non_alimentee').length,
        dimension_native_possible: diagnostics.filter((d) => d.statut === 'dimension_native_possible').length,
        sans_propriete: diagnostics.filter((d) => d.statut === 'sans_propriete').length,
        erreur: diagnostics.filter((d) => d.statut === 'erreur').length,
      },
      diagnostics,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GA4/DIMENSIONS]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
