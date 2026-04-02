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
  startRow = 0,
  rowLimit = 25000,
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
      rowLimit,
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
    const mode: 'incremental' | 'full' | 'smart' = body.mode ?? 'smart';

    const endDate = new Date();
    // GSC a un lag de 2-3 jours — on utilise J-2 comme date de fin
    endDate.setDate(endDate.getDate() - 2);
    const endDateStr = formatDate(endDate);

    const fullStartDate = new Date(endDate);
    fullStartDate.setDate(endDate.getDate() - 738);
    const fullStartDateStr = formatDate(fullStartDate);

    const incrementalStartDate = new Date(endDate);
    incrementalStartDate.setDate(endDate.getDate() - 5);
    const incrementalStartDateStr = formatDate(incrementalStartDate);

    const db = await getDatabase();
    const sites = await db.collection<Site>('sites').find({ active: true }).toArray();

    if (sites.length === 0) {
      return NextResponse.json({ error: 'Aucun site actif trouvé' }, { status: 404 });
    }

    // Mode smart : récupérer la dernière date ingérée par site (gsc_daily)
    const lastDateBySite = new Map<string, string>();
    if (mode === 'smart') {
      const lastDates = await db.collection('gsc_daily').aggregate([
        { $group: { _id: '$siteId', lastDate: { $max: '$dateStr' } } },
      ]).toArray();
      for (const r of lastDates) {
        if (r._id && r.lastDate) lastDateBySite.set(r._id as string, r.lastDate as string);
      }
    }

    const token = await getGoogleAccessToken(GSC_SCOPES);
    const results: { site: string; dailyRecords: number; pageRecords: number; queryRecords: number; startDate: string; errors: string[] }[] = [];

    for (const site of sites) {
      const siteResult = { site: site.name, dailyRecords: 0, pageRecords: 0, queryRecords: 0, startDate: '', errors: [] as string[] };
      const gscSiteUrl = buildSiteUrl(site);

      // Calculer la date de début pour ce site
      let startDateStr: string;
      let startDate: Date;
      if (mode === 'full') {
        startDateStr = fullStartDateStr;
        startDate = fullStartDate;
      } else if (mode === 'smart') {
        const lastDate = lastDateBySite.get(site._id!.toString());
        if (lastDate) {
          const d = new Date(lastDate + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() - 3); // overlap de 3 jours (lag GSC)
          startDateStr = formatDate(d);
          startDate = d;
        } else {
          startDateStr = fullStartDateStr;
          startDate = fullStartDate;
        }
      } else {
        startDateStr = incrementalStartDateStr;
        startDate = incrementalStartDate;
      }
      siteResult.startDate = startDateStr;

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

        // ── 2 & 3. Pages et requêtes — uniquement en mode full ────────────
        // En smart/incremental : skip (data quasi-statique, inutile chaque nuit)
        // En full : top 200 pages + top 500 requêtes sur 30 derniers jours
        if (mode === 'full') {
          const pqEnd = endDate;
          const pqStart = new Date(endDate);
          pqStart.setDate(pqEnd.getDate() - 30);
          const pqStartStr = formatDate(pqStart);
          const pqEndStr = formatDate(pqEnd);

          // Top 200 pages
          const pageRows = await fetchGscData(gscSiteUrl, token, pqStartStr, pqEndStr, ['page'], 0, 200);
          const pageCollection = db.collection<GscPage>('gsc_pages');
          if (pageRows.length > 0) {
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
                    periodStart: pqStart,
                    periodEnd: pqEnd,
                    updatedAt: new Date(),
                  },
                },
                upsert: true,
              },
            }));
            await pageCollection.bulkWrite(pageOps, { ordered: false });
            siteResult.pageRecords = pageOps.length;
          }

          // Top 500 requêtes
          const queryRows = await fetchGscData(gscSiteUrl, token, pqStartStr, pqEndStr, ['query'], 0, 500);
          const queryCollection = db.collection<GscQuery>('gsc_queries');
          if (queryRows.length > 0) {
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
                    periodStart: pqStart,
                    periodEnd: pqEnd,
                    updatedAt: new Date(),
                  },
                },
                upsert: true,
              },
            }));
            await queryCollection.bulkWrite(queryOps, { ordered: false });
            siteResult.queryRecords = queryOps.length;
          }
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
      period: { startDate: mode === 'smart' ? '(par site)' : mode === 'full' ? fullStartDateStr : incrementalStartDateStr, endDate: endDateStr },
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
