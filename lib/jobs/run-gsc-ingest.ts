import { getDatabase } from '../mongodb';
import { getGoogleAccessToken } from '../google-auth';
import type { Site } from '../models/site';
import type { GscDaily, GscPage, GscQuery } from '../models/gsc';

const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

export type GscIngestMode = 'incremental' | 'full' | 'smart';

export interface GscIngestInput {
  mode?: GscIngestMode;
}

export interface GscIngestSiteDetail {
  site: string;
  dailyRecords: number;
  pageRecords: number;
  queryRecords: number;
  startDate: string;
  errors: string[];
}

export interface GscIngestResult {
  mode: GscIngestMode;
  period: { startDate: string; endDate: string };
  sitesProcessed: number;
  totalDaily: number;
  totalPages: number;
  totalQueries: number;
  errors: number;
  details: GscIngestSiteDetail[];
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function buildSiteUrl(site: Site): string {
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

export async function runGscIngest(input: GscIngestInput = {}): Promise<GscIngestResult> {
  const mode: GscIngestMode = input.mode ?? 'smart';

  const endDate = new Date();
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
    throw new Error('Aucun site actif trouvé');
  }

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
  const results: GscIngestSiteDetail[] = [];

  for (const site of sites) {
    const siteResult: GscIngestSiteDetail = {
      site: site.name,
      dailyRecords: 0,
      pageRecords: 0,
      queryRecords: 0,
      startDate: '',
      errors: [],
    };
    const gscSiteUrl = buildSiteUrl(site);

    let startDateStr: string;
    let startDate: Date;
    if (mode === 'full') {
      startDateStr = fullStartDateStr;
      startDate = fullStartDate;
    } else if (mode === 'smart') {
      const lastDate = lastDateBySite.get(site._id!.toString());
      if (lastDate) {
        const d = new Date(lastDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 3);
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
      const dailyRows = await fetchGscData(gscSiteUrl, token, startDateStr, endDateStr, ['date']);
      const dailyCollection = db.collection<GscDaily>('gsc_daily');
      const dailyOps = dailyRows.map((row) => {
        const dateStr = row.keys[0];
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

      if (mode === 'full') {
        const pqEnd = endDate;
        const pqStart = new Date(endDate);
        pqStart.setDate(pqEnd.getDate() - 30);
        const pqStartStr = formatDate(pqStart);
        const pqEndStr = formatDate(pqEnd);

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

  return {
    mode,
    period: {
      startDate: mode === 'smart' ? '(par site)' : mode === 'full' ? fullStartDateStr : incrementalStartDateStr,
      endDate: endDateStr,
    },
    sitesProcessed: results.length,
    totalDaily,
    totalPages,
    totalQueries,
    errors: totalErrors,
    details: results,
  };
}
