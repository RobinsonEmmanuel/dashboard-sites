import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { getGoogleAccessToken } from '@/lib/google-auth';
import type { Site } from '@/lib/models/site';
import type { TrafficDaily } from '@/lib/models/traffic';

const GA4_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

function parseGa4Date(str: string): Date {
  // GA4 retourne les dates au format "YYYYMMDD"
  const year = parseInt(str.substring(0, 4));
  const month = parseInt(str.substring(4, 6)) - 1;
  const day = parseInt(str.substring(6, 8));
  return new Date(Date.UTC(year, month, day));
}

async function fetchGa4Report(
  propertyId: string,
  token: string,
  startDate: string,
  endDate: string,
  eventName: string
): Promise<Map<string, number>> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const body = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { value: eventName, matchType: 'EXACT' },
      },
    },
    orderBys: [{ desc: true, dimension: { dimensionName: 'date' } }],
    limit: 50000,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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
      const dateKey = row.dimensionValues[0].value; // "YYYYMMDD"
      const count = parseInt(row.metricValues[0].value, 10);
      map.set(dateKey, count);
    }
  }

  return map;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: 'incremental' | 'full' = body.mode ?? 'incremental';
    const siteFilter: string | undefined = body.siteId; // optionnel : ingérer un seul site

    // Fenêtre de dates
    const endDate = new Date();
    const startDate = new Date();
    if (mode === 'full') {
      startDate.setDate(endDate.getDate() - 740);
    } else {
      startDate.setDate(endDate.getDate() - 3); // 3 jours pour couvrir le lag GA4
    }
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    const db = await getDatabase();
    const sitesQuery = siteFilter
      ? { _id: siteFilter, active: true }
      : { active: true };
    const sites = await db.collection<Site>('sites').find(sitesQuery).toArray();

    if (sites.length === 0) {
      return NextResponse.json({ error: 'Aucun site actif trouvé' }, { status: 404 });
    }

    const token = await getGoogleAccessToken(GA4_SCOPES);

    const results: { site: string; inserted: number; errors: string[] }[] = [];

    for (const site of sites) {
      const siteResult = { site: site.name, inserted: 0, errors: [] as string[] };

      try {
        // Requête 1 : session_start
        const sessionMap = await fetchGa4Report(
          site.ga4PropertyId,
          token,
          startDateStr,
          endDateStr,
          'session_start'
        );

        // Requête 2 : liens sortants (click ou clic_affiliation)
        let linkMap = new Map<string, number>();
        try {
          linkMap = await fetchGa4Report(
            site.ga4PropertyId,
            token,
            startDateStr,
            endDateStr,
            site.linkEvent
          );
        } catch {
          // Non bloquant : certains sites peuvent ne pas avoir de données de liens
        }

        // Upsert dans MongoDB
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

    return NextResponse.json({
      mode,
      period: { startDate: startDateStr, endDate: endDateStr },
      sitesProcessed: results.length,
      totalRecords: totalInserted,
      errors: totalErrors,
      details: results,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GA4] Erreur générale:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
