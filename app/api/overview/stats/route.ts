import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod, shiftYearBack } from '@/lib/period-utils';

interface KpiSnapshot {
  sessions: number;
  outboundClicks: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  promisesAmount: number;
  promisesRpm: number | null;
}

async function fetchKpis(
  db: Awaited<ReturnType<typeof getDatabase>>,
  startDate: string,
  endDate: string,
  siteId?: string
): Promise<KpiSnapshot> {
  const siteMatch = siteId ? { siteId } : {};

  const [trafficAgg, gscAgg, promisesAgg] = await Promise.all([
    db.collection('traffic_daily').aggregate([
      { $match: { dateStr: { $gte: startDate, $lte: endDate }, ...siteMatch } },
      { $group: { _id: null, sessions: { $sum: '$sessions' }, outboundClicks: { $sum: '$outboundClicks' } } },
    ]).toArray(),

    db.collection('gsc_daily').aggregate([
      { $match: { dateStr: { $gte: startDate, $lte: endDate }, ...siteMatch } },
      {
        $group: {
          _id: null,
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' },
          // CTR pondéré par les impressions
          ctrWeighted: { $sum: { $multiply: ['$ctr', '$impressions'] } },
          impressionsForCtr: { $sum: '$impressions' },
          // Position pondérée par les impressions
          posWeighted: { $sum: { $multiply: ['$position', '$impressions'] } },
        },
      },
    ]).toArray(),

    // Promesses (commission estimée) : bookingDateStr pour Booking, sinon dateStr
    db.collection('affiliation_revenue').aggregate([
      {
        $addFields: {
          _effectiveDate: {
            $cond: {
              if: { $and: [{ $eq: ['$partner', 'booking'] }, { $gt: ['$bookingDateStr', null] }] },
              then: '$bookingDateStr',
              else: '$dateStr',
            },
          },
        },
      },
      {
        $match: {
          _effectiveDate: { $gte: startDate, $lte: endDate },
          ...siteMatch,
          $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
        },
      },
      { $group: { _id: null, total: { $sum: '$commissionActual' } } },
    ]).toArray(),
  ]);

  const t = trafficAgg[0] ?? { sessions: 0, outboundClicks: 0 };
  const g = gscAgg[0] ?? { clicks: 0, impressions: 0, ctrWeighted: 0, impressionsForCtr: 0, posWeighted: 0 };
  const imp = g.impressionsForCtr || 1;
  const promisesAmountRaw = promisesAgg[0]?.total ?? 0;
  const promisesAmount = Math.round(Number(promisesAmountRaw) * 100) / 100;
  const sessions = Number(t.sessions ?? 0);
  const promisesRpm = sessions > 0 ? Math.round(((promisesAmount / sessions) * 1000) * 100) / 100 : null;

  return {
    sessions,
    outboundClicks: t.outboundClicks,
    clicks: g.clicks,
    impressions: g.impressions,
    ctr: g.ctrWeighted / imp,
    position: g.posWeighted / imp,
    promisesAmount,
    promisesRpm,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId') ?? undefined;

    // Support : periodType/periodValue + start/end (comme la page Revenus)
    const periodType = searchParams.get('periodType') ?? 'month';
    const periodValue = searchParams.get('periodValue') ?? undefined;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd = searchParams.get('end') ?? undefined;
    const todayStr = searchParams.get('today') ?? undefined;

    const { startStr, endStr, label } = resolvePeriod(periodType, periodValue, customStart, customEnd, todayStr);
    const start = startStr;
    const end = endStr;

    const db = await getDatabase();
    const trafficCol = db.collection('traffic_daily');
    const gscCol = db.collection('gsc_daily');

    const siteMatch = siteId ? { siteId } : {};

    const getLastDate = async (col: typeof trafficCol, from: string, to: string) => {
      const docs = await col
        .find({ dateStr: { $gte: from, $lte: to }, ...siteMatch }, { projection: { dateStr: 1 } })
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
    const daysEff = (new Date(endEff).getTime() - new Date(start).getTime()) / 86400000 + 1;

    const { n1Start, n1End } = shiftYearBack(start, endEff);
    const n1EndEff = await clampEndToLastAvailable(n1Start, n1End);

    const { n1Start: n2Start, n1End: n2End } = shiftYearBack(n1Start, n1EndEff);
    const n2EndEff = await clampEndToLastAvailable(n2Start, n2End);

    const [current, n1, n2] = await Promise.all([
      fetchKpis(db, start, endEff, siteId),
      fetchKpis(db, n1Start, n1EndEff, siteId),
      fetchKpis(db, n2Start, n2EndEff, siteId),
    ]);

    return NextResponse.json({
      periodType,
      periodValue,
      label,
      days: daysEff,
      range: { start, end: endEff },
      current,
      n1,
      n2,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[OVERVIEW/STATS]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
