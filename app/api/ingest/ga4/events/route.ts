/**
 * GET /api/ingest/ga4/events
 *
 * Diagnostic GA4 : les noms d'événements réellement collectés par chaque propriété,
 * avec leur volume, confrontés à l'événement configuré sur la fiche du site.
 *
 * Raison d'être : l'ingestion filtre sur `eventName` EXACTEMENT égal à `site.linkEvent`.
 * Un nom qui ne correspond pas à la réalité de la propriété ne produit pas d'erreur —
 * il produit zéro, silencieusement, ce qui est indiscernable d'un site sans clic
 * sortant. Cette route rend la différence visible.
 *
 * Paramètres : ?siteId=<id> ou ?propertyId=<id> pour une seule propriété, ?days=30.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDatabase } from '@/lib/mongodb';
import { getGoogleAccessToken } from '@/lib/google-auth';
import type { Site } from '@/lib/models/site';

const GA4_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

/** Noms qui ressemblent à un clic de sortie ou d'affiliation. */
const MOTIFS_CANDIDATS = /click|clic|exit|outbound|affil|sortant/i;

interface EvenementGa4 {
  nom: string;
  evenements: number;
  utilisateurs: number;
}

async function evenementsDeLaPropriete(
  propertyId: string,
  token: string,
  jours: number,
): Promise<EvenementGa4[]> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${jours}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
        orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
        limit: 100,
      }),
    },
  );

  if (!res.ok) {
    const texte = await res.text();
    throw new Error(`GA4 ${res.status}: ${texte.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
  };

  return (data.rows ?? []).map((r) => ({
    nom: r.dimensionValues[0]?.value ?? '',
    evenements: Number(r.metricValues[0]?.value ?? 0),
    utilisateurs: Number(r.metricValues[1]?.value ?? 0),
  }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const propertyId = searchParams.get('propertyId');
    const jours = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10), 1), 365);

    const token = await getGoogleAccessToken(GA4_SCOPES);

    // Propriété seule : utilisé par la fiche site, avant même que le site existe.
    if (propertyId && !siteId) {
      const evenements = await evenementsDeLaPropriete(propertyId, token, jours);
      return NextResponse.json({
        jours,
        propertyId,
        evenements,
        candidats: evenements.filter((e) => MOTIFS_CANDIDATS.test(e.nom)),
      });
    }

    const db = await getDatabase();
    const filtre = siteId && ObjectId.isValid(siteId)
      ? { _id: new ObjectId(siteId) as unknown as never }
      : { active: true };
    const sites = await db.collection<Site>('sites').find(filtre).sort({ name: 1 }).toArray();

    const diagnostics = await Promise.all(sites.map(async (site) => {
      const base = {
        site: site.shortName,
        nom: site.name,
        propertyId: site.ga4PropertyId,
        evenement_configure: site.linkEvent,
      };

      if (!site.ga4PropertyId) {
        return { ...base, statut: 'sans_propriete' as const, evenements: [], candidats: [], correction: 'Aucun Property ID renseigné sur la fiche du site.' };
      }

      try {
        const evenements = await evenementsDeLaPropriete(site.ga4PropertyId, token, jours);
        const candidats = evenements.filter((e) => MOTIFS_CANDIDATS.test(e.nom));
        const configure = evenements.find((e) => e.nom === site.linkEvent);

        if (configure && configure.evenements > 0) {
          return { ...base, statut: 'ok' as const, volume_configure: configure.evenements, evenements, candidats, correction: null };
        }

        const meilleur = candidats.filter((c) => c.nom !== site.linkEvent)
          .sort((a, b) => b.evenements - a.evenements)[0];

        return {
          ...base,
          statut: configure ? ('volume_nul' as const) : ('evenement_absent' as const),
          volume_configure: configure?.evenements ?? 0,
          evenements,
          candidats,
          correction: meilleur
            ? `L'événement « ${site.linkEvent} » ${configure ? 'existe mais ne compte aucun événement' : 'n\'existe pas dans cette propriété'} sur ${jours} jours. Le candidat le plus volumineux est « ${meilleur.nom} » (${meilleur.evenements} événements). À corriger sur la fiche du site.`
            : `Aucun événement ressemblant à un clic sortant n'est collecté sur ${jours} jours. Vérifier le déclencheur GTM de cette propriété avant de changer la configuration.`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ...base, statut: 'erreur' as const, evenements: [], candidats: [], correction: msg };
      }
    }));

    return NextResponse.json({
      jours,
      compteDeService: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
      resume: {
        ok: diagnostics.filter((d) => d.statut === 'ok').length,
        evenement_absent: diagnostics.filter((d) => d.statut === 'evenement_absent').length,
        volume_nul: diagnostics.filter((d) => d.statut === 'volume_nul').length,
        sans_propriete: diagnostics.filter((d) => d.statut === 'sans_propriete').length,
        erreur: diagnostics.filter((d) => d.statut === 'erreur').length,
      },
      diagnostics,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GA4/EVENTS]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
