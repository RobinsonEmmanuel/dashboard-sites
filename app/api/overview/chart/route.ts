import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

function getPeriodDates(period: string): { start: string; end: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  start.setUTCDate(end.getUTCDate() - days + 1);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// Renvoie le label de groupe selon la granularité : "YYYY-MM" ou "YYYY-MM-DD"
function groupKey(dateStr: string, granularity: string): string {
  return granularity === 'month' ? dateStr.substring(0, 7) : dateStr;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') ?? '12m';
    const siteId = searchParams.get('siteId') ?? undefined;
    // granularity auto : day pour ≤30j, month sinon
    const granularity = ['7d', '30d'].includes(period) ? 'day' : 'month';

    const { start, end } = getPeriodDates(period);
    const startN1 = shiftDateStr(start, -365);
    const endN1 = shiftDateStr(end, -365);

    const siteMatch = siteId ? { siteId } : {};
    const db = await getDatabase();

    const [trafficCurrent, trafficN1, gscCurrent, gscN1] = await Promise.all([
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: end }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, granularity === 'month' ? 7 : 10] }, sessions: { $sum: '$sessions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: startN1, $lte: endN1 }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, granularity === 'month' ? 7 : 10] }, sessions: { $sum: '$sessions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: end }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, granularity === 'month' ? 7 : 10] }, clicks: { $sum: '$clicks' }, impressions: { $sum: '$impressions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: startN1, $lte: endN1 }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, granularity === 'month' ? 7 : 10] }, clicks: { $sum: '$clicks' }, impressions: { $sum: '$impressions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
    ]);

    // Construire un set de toutes les clés (période N)
    const keys = new Set<string>();
    [...trafficCurrent, ...gscCurrent].forEach((r) => keys.add(r._id));
    const sortedKeys = Array.from(keys).sort();

    // Maps pour lookup rapide
    const tcMap = new Map(trafficCurrent.map((r) => [r._id, r.sessions]));
    const tn1Map = new Map(trafficN1.map((r) => [r._id, r.sessions]));
    const gcMap = new Map(gscCurrent.map((r) => [r._id, { clicks: r.clicks, impressions: r.impressions }]));
    const gn1Map = new Map(gscN1.map((r) => [r._id, { clicks: r.clicks, impressions: r.impressions }]));

    // N-1 keys sont décalées d'un an — on les mappe sur les clés N courantes
    const tn1ByShift = new Map(trafficN1.map((r, i) => [sortedKeys[i], r.sessions]));
    const gn1ByShift = new Map(gscN1.map((r, i) => [sortedKeys[i], { clicks: r.clicks, impressions: r.impressions }]));

    const points = sortedKeys.map((key) => ({
      key,
      sessions: tcMap.get(key) ?? 0,
      sessionsPY: tn1ByShift.get(key) ?? 0,
      clicks: gcMap.get(key)?.clicks ?? 0,
      clicksPY: gn1ByShift.get(key)?.clicks ?? 0,
      impressions: gcMap.get(key)?.impressions ?? 0,
      impressionsPY: gn1ByShift.get(key)?.impressions ?? 0,
    }));

    return NextResponse.json({ granularity, period, points });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[OVERVIEW/CHART]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
