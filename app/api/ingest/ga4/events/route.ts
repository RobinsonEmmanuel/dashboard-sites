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

/**
 * `click` est l'événement AUTOMATIQUE de GA4 : il compte tous les liens sortants, y
 * compris non affiliés. Tout autre nom est un événement personnalisé, déclenché
 * délibérément sur les liens que l'on veut suivre. Les deux ne mesurent pas la même
 * population, et un site configuré sur `click` alors qu'un événement dédié existe
 * mesure autre chose que ses voisins — sans qu'aucune erreur ne le signale.
 */
const EVENEMENT_GENERIQUE = 'click';

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
        return { ...base, statut: 'sans_propriete' as const, mesure: null, evenements: [], candidats: [], alertes: [], correction: 'Aucun Property ID renseigné sur la fiche du site.' };
      }

      try {
        const evenements = await evenementsDeLaPropriete(site.ga4PropertyId, token, jours);
        const candidats = evenements.filter((e) => MOTIFS_CANDIDATS.test(e.nom));
        const configure = evenements.find((e) => e.nom === site.linkEvent);

        /* Anomalies de collecte : elles invalident les ratios bien avant le choix de
         * l'événement, donc elles se signalent séparément du verdict. */
        const pageView = evenements.find((e) => e.nom === 'page_view')?.evenements ?? 0;
        const sessions = evenements.find((e) => e.nom === 'session_start')?.evenements ?? 0;
        const alertes: string[] = [];
        if (pageView === 0) {
          alertes.push('Aucun page_view collecté : la balise de configuration GA4 ne se déclenche probablement pas. Les sessions et tous les ratios de cette propriété sont douteux.');
        }
        if (configure && sessions > 0 && configure.evenements > sessions) {
          alertes.push(`Plus de clics sortants (${configure.evenements}) que de sessions (${sessions}) : volumétrie implausible, à vérifier avant toute lecture.`);
        }

        if (configure && configure.evenements > 0) {
          // Un événement dédié existe alors que le site compte l'événement générique :
          // il mesure tous les liens sortants là où ses voisins comptent les affiliés.
          const dedie = candidats
            .filter((c) => c.nom !== EVENEMENT_GENERIQUE && c.evenements > 0)
            .sort((a, b) => b.evenements - a.evenements)[0];

          if (site.linkEvent === EVENEMENT_GENERIQUE && dedie) {
            return {
              ...base,
              statut: 'definition_generique' as const,
              mesure: 'liens_sortants_tous' as const,
              volume_configure: configure.evenements,
              evenements, candidats, alertes,
              correction: `Le site compte « click », l'événement automatique de GA4, qui inclut TOUS les liens sortants. L'événement dédié « ${dedie.nom} » existe pourtant dans cette propriété (${dedie.evenements} événements sur ${jours} jours). Tant que ce n'est pas corrigé, le taux de clic sortant de ce site n'est pas comparable à celui des sites qui comptent un événement dédié.`,
            };
          }

          return {
            ...base,
            statut: 'ok' as const,
            mesure: site.linkEvent === EVENEMENT_GENERIQUE ? ('liens_sortants_tous' as const) : ('liens_affilies' as const),
            volume_configure: configure.evenements,
            evenements, candidats, alertes,
            correction: site.linkEvent === EVENEMENT_GENERIQUE
              ? 'Aucun événement dédié n\'existe dans cette propriété : « click » est le seul choix possible, mais il compte tous les liens sortants. Ratio non comparable aux sites disposant d\'un événement dédié.'
              : null,
          };
        }

        const meilleur = candidats.filter((c) => c.nom !== site.linkEvent)
          .sort((a, b) => b.evenements - a.evenements)[0];

        return {
          ...base,
          statut: configure ? ('volume_nul' as const) : ('evenement_absent' as const),
          mesure: null,
          volume_configure: configure?.evenements ?? 0,
          evenements,
          candidats,
          alertes,
          correction: meilleur
            ? `L'événement « ${site.linkEvent} » ${configure ? 'existe mais ne compte aucun événement' : 'n\'existe pas dans cette propriété'} sur ${jours} jours. Le candidat le plus volumineux est « ${meilleur.nom} » (${meilleur.evenements} événements). À corriger sur la fiche du site.`
            : `Aucun événement ressemblant à un clic sortant n'est collecté sur ${jours} jours. Vérifier le déclencheur GTM de cette propriété avant de changer la configuration.`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ...base, statut: 'erreur' as const, mesure: null, evenements: [], candidats: [], alertes: [], correction: msg };
      }
    }));

    return NextResponse.json({
      jours,
      compteDeService: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
      resume: {
        ok: diagnostics.filter((d) => d.statut === 'ok').length,
        definition_generique: diagnostics.filter((d) => d.statut === 'definition_generique').length,
        evenement_absent: diagnostics.filter((d) => d.statut === 'evenement_absent').length,
        volume_nul: diagnostics.filter((d) => d.statut === 'volume_nul').length,
        sans_propriete: diagnostics.filter((d) => d.statut === 'sans_propriete').length,
        erreur: diagnostics.filter((d) => d.statut === 'erreur').length,
        avec_alertes: diagnostics.filter((d) => d.alertes.length > 0).map((d) => d.site),
      },
      definitions_en_usage: [...new Set(sites.map((s) => s.linkEvent))].sort(),
      diagnostics,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GA4/EVENTS]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


/**
 * POST /api/ingest/ga4/events — applique une correspondance explicite site → événement.
 *
 * Corps : { corrections: [{ site: "Portugal", evenement: "clic_exit_link" }, …] }
 *
 * Rien n'est deviné : le choix entre l'événement automatique et un événement dédié est
 * une décision de mesure, pas une déduction. La route se contente d'écrire ce qu'on lui
 * donne, en vérifiant que le site existe.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { corrections?: Array<{ site: string; evenement: string }> };
    const corrections = body?.corrections;
    if (!Array.isArray(corrections) || corrections.length === 0) {
      return NextResponse.json(
        { error: 'Corps attendu : { corrections: [{ site, evenement }] }' },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const col = db.collection<Site>('sites');
    const appliquees: Array<{ site: string; avant: string; apres: string }> = [];
    const ignorees: Array<{ site: string; raison: string }> = [];

    for (const c of corrections) {
      const nom = String(c?.site ?? '').trim();
      const evenement = String(c?.evenement ?? '').trim();
      if (!nom || !evenement) {
        ignorees.push({ site: nom || '(vide)', raison: 'site ou événement manquant' });
        continue;
      }
      const site = await col.findOne({ shortName: nom });
      if (!site) {
        ignorees.push({ site: nom, raison: 'aucun site avec ce shortName' });
        continue;
      }
      if (site.linkEvent === evenement) {
        ignorees.push({ site: nom, raison: 'déjà configuré sur cet événement' });
        continue;
      }
      await col.updateOne({ shortName: nom }, { $set: { linkEvent: evenement, updatedAt: new Date() } });
      appliquees.push({ site: nom, avant: site.linkEvent, apres: evenement });
    }

    return NextResponse.json({
      appliquees,
      ignorees,
      rappel: appliquees.length
        ? 'Relancer une ingestion GA4 en mode « full » pour recalculer l\'historique des clics sortants avec le nouvel événement.'
        : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GA4/EVENTS] POST', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
