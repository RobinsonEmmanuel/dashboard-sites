import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { getGoogleAccessToken } from '@/lib/google-auth';
import type { Site } from '@/lib/models/site';
import type { GscDaily, GscPage, GscQuery } from '@/lib/models/gsc';

const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function buildSiteUrl(site: Site): string {
  // GSC attend "sc-domain:example.com" pour les domaines, ou l'URL complète pour les sites URL
  return site.gscType === 'domain'
    ? `sc-domain:${site.gscSiteUrl}`
    : site.gscSiteUrl;
}

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function fetchGscData(
  siteUrl: string,
  token: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  startRow = 0
): Promise<GscRow[]> {
  const apiUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions,
      rowLimit: 25000,
      startRow,
      searchType: 'web',
    }),
  });

  if (res.status === 403) {
    throw new Error(`Accès refusé (403) — veuillez ajouter le service account à ce site dans Search Console.`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.rows ?? [];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: 'incremental' | 'full' = body.mode ?? 'incremental';

    const endDate = new Date();
    // GSC a un lag de 2-3 jours — on utilise J-2 comme date de fin
    endDate.setDate(endDate.getDate() - 2);
    const startDate = new Date(endDate);
    if (mode === 'full') {
      startDate.setDate(endDate.getDate() - 738); // ~740 jours total
    } else {
      startDate.setDate(endDate.getDate() - 5);
    }

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    const db = await getDatabase();
    const sites = await db.collection<Site>('sites').find({ active: true }).toArray();

    if (sites.length === 0) {
      return NextResponse.json({ error: 'Aucun site actif trouvé' }, { status: 404 });
    }

    const token = await getGoogleAccessToken(GSC_SCOPES);
    const results: { site: string; dailyRecords: number; pageRecords: number; queryRecords: number; errors: string[] }[] = [];

    for (const site of sites) {
      const siteResult = { site: site.name, dailyRecords: 0, pageRecords: 0, queryRecords: 0, errors: [] as string[] };
      const gscSiteUrl = buildSiteUrl(site);

      try {
        // ── 1. Données journalières ───────────────────────────────────────
        const dailyRows = await fetchGscData(gscSiteUrl, token, startDateStr, endDateStr, ['date']);
        const dailyCollection = db.collection<GscDaily>('gsc_daily');
        const dailyOps = dailyRows.map((row) => {
          const dateStr = row.keys[0]; // "YYYY-MM-DD"
          const date = new Date(dateStr + 'T00:00:00.000Z');
          return {
            updateOne: {
              filter: { siteId: site._id!.toString(), dateStr },
              update: {
                $set: {
                  siteId: site._id!.toString(),
                  siteName: site.name,
                  shortName: site.shortName,
                  date,
                  dateStr,
                  clicks: row.clicks,
                  impressions: row.impressions,
                  ctr: row.ctr,
                  position: row.position,
                  updatedAt: new Date(),
                },
              },
              upsert: true,
            },
          };
        });
        if (dailyOps.length > 0) {
          await dailyCollection.bulkWrite(dailyOps);
          siteResult.dailyRecords = dailyOps.length;
        }

        // ── 2. Données par page ───────────────────────────────────────────
        const pageRows = await fetchGscData(gscSiteUrl, token, startDateStr, endDateStr, ['page']);
        const pageCollection = db.collection<GscPage>('gsc_pages');
        const periodStart = startDate;
        const periodEnd = endDate;
        const pageOps = pageRows.map((row) => ({
          updateOne: {
            filter: { siteId: site._id!.toString(), page: row.keys[0] },
            update: {
              $set: {
                siteId: site._id!.toString(),
                siteName: site.name,
                shortName: site.shortName,
                page: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: row.ctr,
                position: row.position,
                periodStart,
                periodEnd,
                updatedAt: new Date(),
              },
            },
            upsert: true,
          },
        }));
        if (pageOps.length > 0) {
          await pageCollection.bulkWrite(pageOps);
          siteResult.pageRecords = pageOps.length;
        }

        // ── 3. Top requêtes ───────────────────────────────────────────────
        const queryRows = await fetchGscData(gscSiteUrl, token, startDateStr, endDateStr, ['query']);
        const queryCollection = db.collection<GscQuery>('gsc_queries');
        const queryOps = queryRows.map((row) => ({
          updateOne: {
            filter: { siteId: site._id!.toString(), query: row.keys[0] },
            update: {
              $set: {
                siteId: site._id!.toString(),
                siteName: site.name,
                shortName: site.shortName,
                query: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: row.ctr,
                position: row.position,
                periodStart,
                periodEnd,
                updatedAt: new Date(),
              },
            },
            upsert: true,
          },
        }));
        if (queryOps.length > 0) {
          await queryCollection.bulkWrite(queryOps);
          siteResult.queryRecords = queryOps.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        siteResult.errors.push(msg);
        console.error(`[GSC] Erreur pour ${site.name}:`, msg);
      }

      results.push(siteResult);
    }

    const totalDaily = results.reduce((s, r) => s + r.dailyRecords, 0);
    const totalPages = results.reduce((s, r) => s + r.pageRecords, 0);
    const totalQueries = results.reduce((s, r) => s + r.queryRecords, 0);
    const totalErrors = results.filter((r) => r.errors.length > 0).length;

    return NextResponse.json({
      mode,
      period: { startDate: startDateStr, endDate: endDateStr },
      sitesProcessed: results.length,
      totalDaily,
      totalPages,
      totalQueries,
      errors: totalErrors,
      details: results,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GSC] Erreur générale:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
