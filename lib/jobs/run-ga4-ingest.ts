import { ObjectId, type Filter, type Document } from 'mongodb';
import { getDatabase } from '../mongodb';
import { getGoogleAccessToken } from '../google-auth';
import type { Site } from '../models/site';
import type { TrafficDaily } from '../models/traffic';

const GA4_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

export type Ga4IngestMode = 'incremental' | 'full' | 'smart';

export interface Ga4IngestInput {
  mode?: Ga4IngestMode;
  siteId?: string;
}

export interface Ga4IngestSiteDetail {
  site: string;
  inserted: number;
  startDate: string;
  errors: string[];
}

export interface Ga4IngestResult {
  mode: Ga4IngestMode;
  period: { startDate: string; endDate: string };
  sitesProcessed: number;
  totalRecords: number;
  errors: number;
  details: Ga4IngestSiteDetail[];
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function parseGa4Date(str: string): Date {
  const year = parseInt(str.substring(0, 4));
  const month = parseInt(str.substring(4, 6)) - 1;
  const day = parseInt(str.substring(6, 8));
  return new Date(Date.UTC(year, month, day));
}

async function runGa4Report(
  propertyId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Map<string, number>> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 API ${res.status} pour property ${propertyId}: ${text}`);
  }
  const data = await res.json();
  const map = new Map<string, number>();
  if (data.rows) {
    for (const row of data.rows) {
      const dateKey = row.dimensionValues[0].value as string;
      const count = parseInt(row.metricValues[0].value, 10);
      map.set(dateKey, count);
    }
  }
  return map;
}

async function fetchSessionsMetric(
  propertyId: string,
  token: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  return runGa4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ desc: true, dimension: { dimensionName: 'date' } }],
    limit: 50000,
  });
}

async function fetchEventCount(
  propertyId: string,
  token: string,
  startDate: string,
  endDate: string,
  eventName: string,
): Promise<Map<string, number>> {
  return runGa4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { value: eventName, matchType: 'EXACT' } },
    },
    orderBys: [{ desc: true, dimension: { dimensionName: 'date' } }],
    limit: 50000,
  });
}

export async function runGa4Ingest(input: Ga4IngestInput = {}): Promise<Ga4IngestResult> {
  const mode: Ga4IngestMode = input.mode ?? 'smart';
  const siteFilter = input.siteId;

  const endDate = new Date();
  const endDateStr = formatDate(endDate);

  const fullStartDate = new Date();
  fullStartDate.setDate(endDate.getDate() - 740);
  const fullStartDateStr = formatDate(fullStartDate);

  const incrementalStartDate = new Date();
  incrementalStartDate.setDate(endDate.getDate() - 3);
  const incrementalStartDateStr = formatDate(incrementalStartDate);

  const db = await getDatabase();
  const sitesQuery = (
    siteFilter && ObjectId.isValid(siteFilter)
      ? { _id: new ObjectId(siteFilter), active: true }
      : siteFilter
        ? { _id: siteFilter, active: true }
        : { active: true }
  ) as Filter<Document>;
  const sites = (await db.collection('sites').find(sitesQuery).toArray()) as unknown as Site[];

  if (sites.length === 0) {
    throw new Error('Aucun site actif trouvé');
  }

  const lastDateBySite = new Map<string, string>();
  if (mode === 'smart') {
    const lastDates = await db.collection('traffic_daily').aggregate([
      { $group: { _id: '$siteId', lastDate: { $max: '$dateStr' } } },
    ]).toArray();
    for (const r of lastDates) {
      if (r._id && r.lastDate) lastDateBySite.set(r._id as string, r.lastDate as string);
    }
  }

  const token = await getGoogleAccessToken(GA4_SCOPES);
  const results: Ga4IngestSiteDetail[] = [];

  for (const site of sites) {
    const siteResult: Ga4IngestSiteDetail = { site: site.name, inserted: 0, startDate: '', errors: [] };

    let startDateStr: string;
    if (mode === 'full') {
      startDateStr = fullStartDateStr;
    } else if (mode === 'smart') {
      const lastDate = lastDateBySite.get(site._id!.toString());
      if (lastDate) {
        const d = new Date(lastDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 3);
        startDateStr = formatDate(d);
      } else {
        startDateStr = fullStartDateStr;
      }
    } else {
      startDateStr = incrementalStartDateStr;
    }
    siteResult.startDate = startDateStr;

    try {
      const sessionMap = await fetchSessionsMetric(site.ga4PropertyId, token, startDateStr, endDateStr);

      let linkMap = new Map<string, number>();
      try {
        linkMap = await fetchEventCount(
          site.ga4PropertyId,
          token,
          startDateStr,
          endDateStr,
          site.linkEvent,
        );
      } catch {
        // non bloquant
      }

      const trafficCollection = db.collection<TrafficDaily>('traffic_daily');
      const operations = [];

      for (const [dateKey, sessions] of sessionMap) {
        const date = parseGa4Date(dateKey);
        const dateStr = formatDate(date);
        const outboundClicks = linkMap.get(dateKey) ?? 0;

        operations.push({
          updateOne: {
            filter: { siteId: site._id!.toString(), dateStr },
            update: {
              $set: {
                siteId: site._id!.toString(),
                siteName: site.name,
                shortName: site.shortName,
                date,
                dateStr,
                sessions,
                outboundClicks,
                updatedAt: new Date(),
              },
            },
            upsert: true,
          },
        });
      }

      if (operations.length > 0) {
        await trafficCollection.bulkWrite(operations);
        siteResult.inserted = operations.length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      siteResult.errors.push(msg);
      console.error(`[GA4] Erreur pour ${site.name}:`, msg);
    }

    results.push(siteResult);
  }

  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
  const totalErrors = results.filter((r) => r.errors.length > 0).length;

  return {
    mode,
    period: {
      startDate: mode === 'smart' ? '(par site)' : mode === 'full' ? fullStartDateStr : incrementalStartDateStr,
      endDate: endDateStr,
    },
    sitesProcessed: results.length,
    totalRecords: totalInserted,
    errors: totalErrors,
    details: results,
  };
}
