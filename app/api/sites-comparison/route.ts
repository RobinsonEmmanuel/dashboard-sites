import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePreset, shiftYearBack } from '@/lib/period-utils';
import type { PeriodPreset } from '@/lib/period-utils';

function pct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const preset = (searchParams.get('preset') ?? 'current-month') as PeriodPreset;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd   = searchParams.get('end')   ?? undefined;
    const { start, end } = resolvePreset(preset, customStart, customEnd);
    const { n1Start: startN1, n1End: endN1 } = shiftYearBack(start, end);

    const db = await getDatabase();

    // ── Agrégation trafic par site ────────────────────────────────────────────
    const [trafficCur, trafficN1, gscCur, gscN1] = await Promise.all([
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: end } } },
        { $group: { _id: '$siteId', siteName: { $first: '$siteName' }, shortName: { $first: '$shortName' }, sessions: { $sum: '$sessions' }, outboundClicks: { $sum: '$outboundClicks' } } },
      ]).toArray(),
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: startN1, $lte: endN1 } } },
        { $group: { _id: '$siteId', sessions: { $sum: '$sessions' }, outboundClicks: { $sum: '$outboundClicks' } } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: end } } },
        { $group: {
          _id: '$siteId',
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' },
          ctrWeighted: { $sum: { $multiply: ['$ctr', '$impressions'] } },
          posWeighted: { $sum: { $multiply: ['$position', '$impressions'] } },
          impressionsForAvg: { $sum: '$impressions' },
        } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: startN1, $lte: endN1 } } },
        { $group: {
          _id: '$siteId',
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' },
        } },
      ]).toArray(),
    ]);

    // ── Maps pour lookup rapide ───────────────────────────────────────────────
    const tn1Map = new Map(trafficN1.map((r) => [r._id, r]));
    const gscMap = new Map(gscCur.map((r) => [r._id, r]));
    const gn1Map = new Map(gscN1.map((r) => [r._id, r]));

    // ── Construire le tableau de comparaison ─────────────────────────────────
    const rows = trafficCur.map((t) => {
      const tprev = tn1Map.get(t._id);
      const g = gscMap.get(t._id);
      const gprev = gn1Map.get(t._id);
      const imp = g?.impressionsForAvg || 1;

      return {
        siteId: t._id,
        siteName: t.siteName,
        shortName: t.shortName,
        sessions: t.sessions,
        sessionsDelta: pct(t.sessions, tprev?.sessions ?? 0),
        outboundClicks: t.outboundClicks,
        clicks: g?.clicks ?? 0,
        clicksDelta: pct(g?.clicks ?? 0, gprev?.clicks ?? 0),
        impressions: g?.impressions ?? 0,
        impressionsDelta: pct(g?.impressions ?? 0, gprev?.impressions ?? 0),
        ctr: g ? g.ctrWeighted / imp : 0,
        position: g ? g.posWeighted / imp : 0,
      };
    });

    // Trier par sessions décroissant par défaut
    rows.sort((a, b) => b.sessions - a.sessions);

    return NextResponse.json({ preset, range: { start, end }, rows });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[SITES-COMPARISON]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
