import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod, shiftYearBack } from '@/lib/period-utils';

function pct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const periodType = searchParams.get('periodType') ?? 'month';
    const periodValue = searchParams.get('periodValue') ?? undefined;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd   = searchParams.get('end')   ?? undefined;
    const { startStr, endStr } = resolvePeriod(periodType, periodValue, customStart, customEnd);
    const start = startStr;
    const end = endStr;

    const db = await getDatabase();

    const trafficCol = db.collection('traffic_daily');
    const gscCol = db.collection('gsc_daily');

    const getLastDate = async (col: typeof trafficCol, from: string, to: string) => {
      const docs = await col
        .find({ dateStr: { $gte: from, $lte: to } }, { projection: { dateStr: 1 } })
        .sort({ dateStr: -1 })
        .limit(1)
        .toArray();
      return docs[0]?.dateStr ? String(docs[0].dateStr) : null;
    };

    const clampEndToLastAvailable = async (from: string, to: string) => {
      const [lastTraffic, lastGsc] = await Promise.all([
        getLastDate(trafficCol, from, to),
        getLastDate(gscCol, from, to),
      ]);
      if (lastTraffic && lastGsc) return lastTraffic < lastGsc ? lastTraffic : lastGsc;
      return lastTraffic ?? lastGsc ?? to;
    };

    const endEff = await clampEndToLastAvailable(start, end);
    const { n1Start: startN1, n1End: endN1 } = shiftYearBack(start, endEff);
    const endN1Eff = await clampEndToLastAvailable(startN1, endN1);

    // ── Agrégation trafic par site ────────────────────────────────────────────
    const [trafficCur, trafficN1, gscCur, gscN1] = await Promise.all([
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: endEff } } },
        { $group: { _id: '$siteId', siteName: { $first: '$siteName' }, shortName: { $first: '$shortName' }, sessions: { $sum: '$sessions' }, outboundClicks: { $sum: '$outboundClicks' } } },
      ]).toArray(),
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: startN1, $lte: endN1Eff } } },
        { $group: { _id: '$siteId', sessions: { $sum: '$sessions' }, outboundClicks: { $sum: '$outboundClicks' } } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: endEff } } },
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
        { $match: { dateStr: { $gte: startN1, $lte: endN1Eff } } },
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

    return NextResponse.json({ periodType, range: { start, end: endEff }, rows });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[SITES-COMPARISON]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
