/**
 * GET /api/ingest/gsc/properties
 *
 * Diagnostic Search Console : liste les propriétés réellement visibles par le compte
 * de service, et les confronte à la configuration des sites.
 *
 * Raison d'être : l'API Search Console répond 403 aussi bien quand le compte de service
 * n'est pas autorisé sur une propriété que quand la propriété demandée n'existe pas
 * sous cette forme (un site déclaré « domain » interrogé en `sc-domain:` alors que la
 * propriété est en préfixe d'URL, ou l'inverse). Le message d'erreur ne permet donc pas
 * de trancher — cette route le fait, en montrant l'identifiant attendu à côté de ceux
 * qui existent vraiment.
 */

import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { getGoogleAccessToken } from '@/lib/google-auth';
import type { Site } from '@/lib/models/site';

const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

/** Même construction que l'ingestion : c'est cet identifiant exact qui est interrogé. */
function identifiantAttendu(site: Site): string {
  return site.gscType === 'domain' ? `sc-domain:${site.gscSiteUrl}` : site.gscSiteUrl;
}

/** Nom d'hôte comparable, quelle que soit la forme de la propriété. */
function hote(identifiant: string): string {
  return identifiant
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export async function GET() {
  try {
    const db = await getDatabase();
    const sites = await db.collection<Site>('sites')
      .find({}, { projection: { name: 1, shortName: 1, gscSiteUrl: 1, gscType: 1, active: 1 } })
      .toArray();

    const token = await getGoogleAccessToken(GSC_SCOPES);
    const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const texte = await res.text();
      return NextResponse.json(
        {
          error: `Search Console a refusé la liste des propriétés (HTTP ${res.status}). ${texte.slice(0, 300)}`,
          compteDeService: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
        },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
    };
    const proprietes = data.siteEntry ?? [];
    const parIdentifiant = new Map(proprietes.map((p) => [p.siteUrl, p.permissionLevel]));

    const diagnostics = sites.map((site) => {
      const attendu = identifiantAttendu(site);
      const permission = parIdentifiant.get(attendu);
      if (permission) {
        return {
          site: site.shortName,
          nom: site.name,
          actif: site.active,
          identifiant_attendu: attendu,
          statut: 'ok' as const,
          permission,
          correction: null,
        };
      }

      // La propriété existe peut-être sous une AUTRE forme : c'est le cas le plus
      // fréquent, et il se corrige en changeant le type du site, pas les droits.
      const memeHote = proprietes.filter((p) => hote(p.siteUrl) === hote(attendu));
      if (memeHote.length > 0) {
        const typeAttendu = memeHote[0].siteUrl.startsWith('sc-domain:') ? 'domain' : 'url';
        return {
          site: site.shortName,
          nom: site.name,
          actif: site.active,
          identifiant_attendu: attendu,
          statut: 'mauvais_type' as const,
          permission: memeHote[0].permissionLevel,
          correction:
            `La propriété existe sous la forme « ${memeHote[0].siteUrl} ». Passer le type du site de ` +
            `« ${site.gscType} » à « ${typeAttendu} »` +
            (typeAttendu === 'url' ? ` et renseigner l'URL exacte « ${memeHote[0].siteUrl} ».` : '.'),
        };
      }

      return {
        site: site.shortName,
        nom: site.name,
        actif: site.active,
        identifiant_attendu: attendu,
        statut: 'sans_acces' as const,
        permission: null,
        correction:
          `Aucune propriété correspondante n'est visible par le compte de service. Dans Search Console, ` +
          `ouvrir la propriété, puis Paramètres → Utilisateurs et autorisations, et ajouter ` +
          `${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '(GOOGLE_SERVICE_ACCOUNT_EMAIL non définie)'} ` +
          `en lecture. Vérifier aussi l'orthographe du domaine sur la fiche du site.`,
      };
    });

    return NextResponse.json({
      compteDeService: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
      proprietes_visibles: proprietes.map((p) => ({ identifiant: p.siteUrl, permission: p.permissionLevel })),
      /** Propriétés accessibles qui ne correspondent à aucun site configuré. */
      proprietes_non_configurees: proprietes
        .filter((p) => !sites.some((s) => hote(identifiantAttendu(s)) === hote(p.siteUrl)))
        .map((p) => p.siteUrl),
      diagnostics,
      resume: {
        ok: diagnostics.filter((d) => d.statut === 'ok').length,
        mauvais_type: diagnostics.filter((d) => d.statut === 'mauvais_type').length,
        sans_acces: diagnostics.filter((d) => d.statut === 'sans_acces').length,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GSC/PROPERTIES]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
