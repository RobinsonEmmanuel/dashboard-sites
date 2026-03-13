import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';
import type { RevenueChartPoint } from '@/lib/models/revenue';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodType  = searchParams.get('periodType')  || 'year';
    const periodValue = searchParams.get('periodValue');
    const customStart = searchParams.get('start');
    const customEnd   = searchParams.get('end');
    const siteFilter  = searchParams.get('site');

    const { startStr, endStr, granularity } = resolvePeriod(
      periodType, periodValue, customStart, customEnd,
    );

    const db  = await getDatabase();
    const col = db.collection('affiliation_revenue');

    const match: Record<string, unknown> = {
      dateStr: { $gte: startStr, $lte: endStr },
      $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
    };
    if (siteFilter) match.siteName = siteFilter;

    // Grouper par jour ou par mois selon la granularité
    const groupKey = granularity === 'day'
      ? { $substr: ['$dateStr', 0, 10] }   // YYYY-MM-DD
      : { $substr: ['$dateStr', 0, 7] };   // YYYY-MM

    const agg = await col.aggregate([
      { $match: match },
      {
        $group: {
          _id:   { period: groupKey, partner: '$partner' },
          total: { $sum: '$commissionActual' },
        },
      },
      { $sort: { '_id.period': 1 } },
    ]).toArray();

    // Construire la liste de tous les points de la période
    const allPeriods: string[] = [];
    const start = new Date(startStr);
    const end   = new Date(endStr);

    if (granularity === 'day') {
      const d = new Date(start);
      while (d <= end) {
        allPeriods.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
    } else {
      const d = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (d <= endMonth) {
        allPeriods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        d.setMonth(d.getMonth() + 1);
      }
    }

    // Remplir les données
    const periodMap: Record<string, RevenueChartPoint> = {};
    for (const p of allPeriods) {
      periodMap[p] = { month: p, getyourguide: 0, booking: 0, tiqets: 0, discovercars: 0, sendowl: 0, total: 0 };
    }

    for (const item of agg) {
      const { period, partner } = item._id;
      if (!periodMap[period]) continue;
      const val = Math.round(item.total * 100) / 100;
      (periodMap[period] as unknown as Record<string, number>)[partner] = val;
      periodMap[period].total = Math.round((periodMap[period].total + val) * 100) / 100;
    }

    return NextResponse.json({
      periodType,
      granularity,
      startStr,
      endStr,
      data: Object.values(periodMap),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
