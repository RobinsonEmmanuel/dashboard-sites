import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';

function shiftYearBack(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

type ChartRow = {
  month: string; // YYYY-MM or YYYY-MM-DD depending on granularity
  total: number | null;
  totalN1: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodType = searchParams.get('periodType') || 'month';
    const periodValue = searchParams.get('periodValue');
    const customStart = searchParams.get('start');
    const customEnd = searchParams.get('end');
    const siteFilter = searchParams.get('site');

    const todayStr =
      searchParams.get('today') ??
      new Date().toISOString().slice(0, 10);

    const { startStr, endStr, granularity } = resolvePeriod(
      periodType,
      periodValue,
      customStart,
      customEnd,
      todayStr,
    );

    const yesterdayDate = new Date(todayStr + 'T00:00:00Z');
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    const endOfPreviousMonthStr = (() => {
      // "Aujourd'hui" (local) est passé via todayStr; on calcule fin du mois précédent en UTC.
      const d = new Date(todayStr + 'T00:00:00Z');
      // Aller au 1er du mois courant puis reculer d'1 jour.
      d.setUTCDate(1);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    const shiftKeyYearBackStr = (key: string, gran: 'day' | 'month'): string => {
      if (gran === 'month') {
        // key: YYYY-MM
        const [yStr, mStr] = key.split('-');
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        const d = new Date(Date.UTC(y, m - 1, 1));
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      }
      // key: YYYY-MM-DD
      return shiftYearBack(key);
    };

    // Ne pas afficher la période "en cours" sur l'axe X :
    // - granularité jour : exclure le jour en cours (J)
    // - granularité mois (cas année) : exclure le mois en cours
    const effectiveEndStr = (() => {
      if (granularity === 'day' && endStr >= todayStr) return yesterdayStr;
      if (granularity === 'month' && periodType === 'year' && endStr >= todayStr) return endOfPreviousMonthStr;
      return endStr;
    })();

    const n1StartStr = shiftYearBack(startStr);
    const n1EndStr = shiftYearBack(effectiveEndStr);

    const db = await getDatabase();
    const col = db.collection('affiliation_revenue');

    const makeBaseMatchPipeline = (start: string, end: string) => [
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
        },
      },
      {
        $match: {
          _effectiveDate: { $gte: start, $lte: end },
          ...(siteFilter ? { siteName: siteFilter } : {}),
        },
      },
    ];

    // Revenus (hors annulés)
    const nonCancelFilter = {
      $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
    };

    const slice = granularity === 'day' ? 10 : 7;
    const groupKey = granularity === 'day'
      ? { $substr: ['$_effectiveDate', 0, slice] }
      : { $substr: ['$_effectiveDate', 0, slice] };

    const aggToMap = async (start: string, end: string) => {
      const rows = await col.aggregate([
        ...makeBaseMatchPipeline(start, end),
        { $match: nonCancelFilter },
        {
          $group: {
            _id: groupKey,
            total: { $sum: '$commissionActual' },
          },
        },
        { $sort: { _id: 1 } },
      ]).toArray();

      const map: Record<string, number> = {};
      for (const r of rows) {
        const key = r._id as string;
        if (!key) continue;
        map[key] = Math.round((r.total as number) * 100) / 100;
      }
      return map;
    };

    const [mapN, mapN1] = await Promise.all([
      aggToMap(startStr, effectiveEndStr),
      aggToMap(n1StartStr, n1EndStr),
    ]);

    // Construire la liste de points de l'axe
    const allPeriods: string[] = [];
    if (granularity === 'day') {
      const d = new Date(startStr + 'T00:00:00.000Z');
      const end = new Date(effectiveEndStr + 'T00:00:00.000Z');
      while (d <= end) {
        allPeriods.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
      }
    } else {
      const d = new Date(startStr + 'T00:00:00.000Z');
      const end = new Date(endStr + 'T00:00:00.000Z');
      d.setUTCDate(1);
      end.setUTCDate(1);
      while (d <= end) {
        allPeriods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
        d.setUTCMonth(d.getUTCMonth() + 1);
      }
    }

    const data: ChartRow[] = allPeriods.map((p) => ({
      month: p,
      total: mapN[p] ?? null,
      totalN1: mapN1[shiftKeyYearBackStr(p, granularity === 'day' ? 'day' : 'month')] ?? null,
    }));

    return NextResponse.json({
      periodType,
      granularity,
      startStr,
      endStr: effectiveEndStr,
      data,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

