import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function getPeriodDates(period: string): { start: string; end: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // hier
  const start = new Date(end);

  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  start.setUTCDate(end.getUTCDate() - days + 1);

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

interface KpiSnapshot {
  sessions: number;
  outboundClicks: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function fetchKpis(
  db: Awaited<ReturnType<typeof getDatabase>>,
  startDate: string,
  endDate: string,
  siteId?: string
): Promise<KpiSnapshot> {
  const siteMatch = siteId ? { siteId } : {};

  const [trafficAgg, gscAgg] = await Promise.all([
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
  ]);

  const t = trafficAgg[0] ?? { sessions: 0, outboundClicks: 0 };
  const g = gscAgg[0] ?? { clicks: 0, impressions: 0, ctrWeighted: 0, impressionsForCtr: 0, posWeighted: 0 };
  const imp = g.impressionsForCtr || 1;

  return {
    sessions: t.sessions,
    outboundClicks: t.outboundClicks,
    clicks: g.clicks,
    impressions: g.impressions,
    ctr: g.ctrWeighted / imp,
    position: g.posWeighted / imp,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') ?? '30d';
    const siteId = searchParams.get('siteId') ?? undefined;

    const { start, end } = getPeriodDates(period);
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1;

    const startN1 = shiftDate(start, -365);
    const endN1 = shiftDate(end, -365);
    const startN2 = shiftDate(start, -730);
    const endN2 = shiftDate(end, -730);

    const db = await getDatabase();
    const [current, n1, n2] = await Promise.all([
      fetchKpis(db, start, end, siteId),
      fetchKpis(db, startN1, endN1, siteId),
      fetchKpis(db, startN2, endN2, siteId),
    ]);

    return NextResponse.json({
      period,
      days,
      range: { start, end },
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
