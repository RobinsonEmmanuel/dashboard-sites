import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePreset, shiftYearBack } from '@/lib/period-utils';
import type { PeriodPreset } from '@/lib/period-utils';

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
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
    const siteId = searchParams.get('siteId') ?? undefined;

    // Accepte soit preset+custom, soit start+end directs
    const preset = (searchParams.get('preset') ?? 'current-month') as PeriodPreset;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd   = searchParams.get('end')   ?? undefined;
    const { start, end } = resolvePreset(preset, customStart, customEnd);

    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1;
    const { n1Start, n1End }   = shiftYearBack(start, end);
    const { n1Start: n2Start, n1End: n2End } = shiftYearBack(n1Start, n1End);

    const db = await getDatabase();
    const [current, n1, n2] = await Promise.all([
      fetchKpis(db, start, end, siteId),
      fetchKpis(db, n1Start, n1End, siteId),
      fetchKpis(db, n2Start, n2End, siteId),
    ]);

    return NextResponse.json({
      preset,
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
