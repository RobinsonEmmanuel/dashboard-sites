import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePreset, shiftYearBack } from '@/lib/period-utils';
import type { PeriodPreset } from '@/lib/period-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId') ?? undefined;

    const preset = (searchParams.get('preset') ?? 'current-month') as PeriodPreset;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd   = searchParams.get('end')   ?? undefined;
    const { start, end } = resolvePreset(preset, customStart, customEnd);
    const { n1Start, n1End } = shiftYearBack(start, end);

    const diffDays = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
    const granularity = diffDays <= 60 ? 'day' : 'month';

    const siteMatch = siteId ? { siteId } : {};
    const db = await getDatabase();
    const slice = granularity === 'month' ? 7 : 10;

    const [trafficCur, trafficN1, gscCur, gscN1] = await Promise.all([
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: end }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, sessions: { $sum: '$sessions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: n1Start, $lte: n1End }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, sessions: { $sum: '$sessions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: end }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, clicks: { $sum: '$clicks' }, impressions: { $sum: '$impressions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: n1Start, $lte: n1End }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, clicks: { $sum: '$clicks' }, impressions: { $sum: '$impressions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
    ]);

    const keys = new Set<string>();
    [...trafficCur, ...gscCur].forEach((r) => keys.add(r._id));
    const sortedKeys = Array.from(keys).sort();

    const tcMap  = new Map(trafficCur.map((r) => [r._id, r.sessions]));
    const gcMap  = new Map(gscCur.map((r) => [r._id, { clicks: r.clicks, impressions: r.impressions }]));
    // N-1 keys sont dans l'espace temporel N-1 → on les aligne par rang
    const tn1ByRank = new Map(trafficN1.map((r, i) => [sortedKeys[i], r.sessions]));
    const gn1ByRank = new Map(gscN1.map((r, i) => [sortedKeys[i], { clicks: r.clicks, impressions: r.impressions }]));

    const points = sortedKeys.map((key) => ({
      key,
      sessions:       tcMap.get(key) ?? 0,
      sessionsPY:     tn1ByRank.get(key) ?? 0,
      clicks:         gcMap.get(key)?.clicks ?? 0,
      clicksPY:       gn1ByRank.get(key)?.clicks ?? 0,
      impressions:    gcMap.get(key)?.impressions ?? 0,
      impressionsPY:  gn1ByRank.get(key)?.impressions ?? 0,
    }));

    return NextResponse.json({ granularity, preset, points });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[OVERVIEW/CHART]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
