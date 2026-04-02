import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';

function shiftYearBack(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

type BySiteRow = {
  siteName: string;
  revenue: number;
  revenueN1: number;
  evolution: number | null;
  bookingsTotal: number;
  cancelledCount: number;
  cancelRate: number | null;
  cancelRateN1: number | null;
  sharePct: number;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodType = searchParams.get('periodType') || 'month';
    const periodValue = searchParams.get('periodValue');
    const customStart = searchParams.get('start');
    const customEnd = searchParams.get('end');
    const siteFilter = searchParams.get('site');

    const todayStr = searchParams.get('today') ?? new Date().toISOString().slice(0, 10);
    const resolved = resolvePeriod(periodType, periodValue, customStart, customEnd, todayStr);
    const { startStr } = resolved;
    let { endStr } = resolved;

    // Ne pas inclure le jour en cours dans les agrégats (N et N-1)
    const yesterdayDate = new Date(todayStr + 'T00:00:00Z');
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    if (resolved.granularity === 'day' && endStr >= todayStr) {
      endStr = yesterdayStr;
    }

    const n1StartStr = shiftYearBack(startStr);
    const n1EndStr = shiftYearBack(endStr);

    const db = await getDatabase();
    const col = db.collection('affiliation_revenue');

    const makeMatchPipeline = (start: string, end: string) => [
      {
        $addFields: {
          _effectiveDate: {
            $cond: {
              if: {
                $and: [
                  { $eq: ['$partner', 'booking'] },
                  { $gt: ['$bookingDateStr', null] },
                ],
              },
              then: '$bookingDateStr',
              else: '$dateStr',
            },
          },
          _siteKey: {
            $cond: {
              if: { $or: [{ $eq: ['$siteName', null] }, { $eq: ['$siteName', ''] }] },
              then: 'Non attribué',
              else: '$siteName',
            },
          },
        },
      },
      {
        $match: {
          _effectiveDate: { $gte: start, $lte: end },
          ...(siteFilter ? { siteName: siteFilter } : {}),
        },
      },
    ];

    const nonCancelFilter = {
      $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
    };
    const cancelFilter = { status: /cancel/i };

    const [
      revenueRows,
      revenueN1Rows,
      totalRows,
      cancelledRows,
      totalN1Rows,
      cancelledN1Rows,
    ] = await Promise.all([
      col.aggregate([
        ...makeMatchPipeline(startStr, endStr),
        { $match: nonCancelFilter },
        { $group: { _id: '$_siteKey', revenue: { $sum: '$commissionActual' } } },
      ]).toArray(),
      col.aggregate([
        ...makeMatchPipeline(n1StartStr, n1EndStr),
        { $match: nonCancelFilter },
        { $group: { _id: '$_siteKey', revenue: { $sum: '$commissionActual' } } },
      ]).toArray(),
      col.aggregate([
        ...makeMatchPipeline(startStr, endStr),
        { $group: { _id: '$_siteKey', total: { $sum: 1 } } },
      ]).toArray(),
      col.aggregate([
        ...makeMatchPipeline(startStr, endStr),
        { $match: cancelFilter },
        { $group: { _id: '$_siteKey', cancelled: { $sum: 1 } } },
      ]).toArray(),
      col.aggregate([
        ...makeMatchPipeline(n1StartStr, n1EndStr),
        { $group: { _id: '$_siteKey', total: { $sum: 1 } } },
      ]).toArray(),
      col.aggregate([
        ...makeMatchPipeline(n1StartStr, n1EndStr),
        { $match: cancelFilter },
        { $group: { _id: '$_siteKey', cancelled: { $sum: 1 } } },
      ]).toArray(),
    ]);

    const revenueMap = Object.fromEntries(
      revenueRows.map((r) => [String(r._id), Math.round((r.revenue as number) * 100) / 100]),
    );
    const revenueN1Map = Object.fromEntries(
      revenueN1Rows.map((r) => [String(r._id), Math.round((r.revenue as number) * 100) / 100]),
    );
    const totalMap = Object.fromEntries(totalRows.map((r) => [String(r._id), r.total as number]));
    const cancelledMap = Object.fromEntries(cancelledRows.map((r) => [String(r._id), r.cancelled as number]));
    const totalN1Map = Object.fromEntries(totalN1Rows.map((r) => [String(r._id), r.total as number]));
    const cancelledN1Map = Object.fromEntries(cancelledN1Rows.map((r) => [String(r._id), r.cancelled as number]));

    const keys = new Set<string>([
      ...Object.keys(revenueMap),
      ...Object.keys(revenueN1Map),
      ...Object.keys(totalMap),
      ...Object.keys(cancelledMap),
      ...Object.keys(totalN1Map),
      ...Object.keys(cancelledN1Map),
    ]);

    const bySite: BySiteRow[] = [];
    const totalRevenue = Array.from(keys).reduce((sum, k) => sum + (revenueMap[k] ?? 0), 0);

    for (const siteName of keys) {
      const revenue = revenueMap[siteName] ?? 0;
      const revenueN1 = revenueN1Map[siteName] ?? 0;
      const bookingsTotal = totalMap[siteName] ?? 0;
      const cancelledCount = cancelledMap[siteName] ?? 0;
      const totalN1 = totalN1Map[siteName] ?? 0;
      const cancelledN1 = cancelledN1Map[siteName] ?? 0;

      const cancelRate = bookingsTotal > 0 ? Math.round((cancelledCount / bookingsTotal) * 1000) / 10 : null;
      const cancelRateN1 = totalN1 > 0 ? Math.round((cancelledN1 / totalN1) * 1000) / 10 : null;

      const evolution =
        revenueN1 > 0
          ? Math.round(((revenue - revenueN1) / revenueN1) * 1000) / 10
          : revenue > 0
            ? null
            : null;

      const sharePct = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;

      // Même logique que pour la table plateforme : ne pas masquer un site s'il a du revenue N
      if (!(bookingsTotal > 0 || revenue > 0 || revenueN1 > 0)) continue;

      bySite.push({
        siteName,
        revenue,
        revenueN1,
        evolution,
        bookingsTotal,
        cancelledCount,
        cancelRate,
        cancelRateN1,
        sharePct,
      });
    }

    bySite.sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      startStr,
      endStr,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      bySite,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

