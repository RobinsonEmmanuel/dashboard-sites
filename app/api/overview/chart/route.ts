import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod, shiftYearBack } from '@/lib/period-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId') ?? undefined;

    const periodType = searchParams.get('periodType') ?? 'month';
    const periodValue = searchParams.get('periodValue') ?? undefined;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd   = searchParams.get('end')   ?? undefined;
    const todayStr = searchParams.get('today') ?? undefined;
    const { startStr, endStr } = resolvePeriod(periodType, periodValue, customStart, customEnd, todayStr);
    const start = startStr;
    const end = endStr;

    const db = await getDatabase();
    const trafficCol = db.collection('traffic_daily');
    const gscCol = db.collection('gsc_daily');
    const revenueCol = db.collection('affiliation_revenue');
    const siteMatch = siteId ? { siteId } : {};

    const { n1Start, n1End } = shiftYearBack(start, end);

    const getLastDate = async (col: typeof trafficCol, from: string, to: string) => {
      const docs = await col
        .find({ dateStr: { $gte: from, $lte: to }, ...siteMatch }, { projection: { dateStr: 1 } })
        .sort({ dateStr: -1 })
        .limit(1)
        .toArray();
      return docs[0]?.dateStr ? String(docs[0].dateStr) : null;
    };

    // "Aujourd'hui" est envoyé par le navigateur (timezone locale) via ?today=YYYY-MM-DD
    // On l'utilise pour éviter de masquer un jour complet à cause d'un décalage UTC.
    const todayStrEff = todayStr ?? new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(todayStrEff + 'T00:00:00Z');
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayStrUTC = yesterdayDate.toISOString().slice(0, 10);
    const dayBeforeYesterdayDate = new Date(yesterdayStrUTC + 'T00:00:00Z');
    dayBeforeYesterdayDate.setUTCDate(dayBeforeYesterdayDate.getUTCDate() - 1);
    const dayBeforeYesterdayStrUTC = dayBeforeYesterdayDate.toISOString().slice(0, 10);

    const shiftOneYearBackStr = (dateStr: string): string => {
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return d.toISOString().slice(0, 10);
    };

    const yesterdayN1Str = shiftOneYearBackStr(yesterdayStrUTC); // borne GA4 N-1 = (today-1) - 1 an
    const dayBeforeYesterdayN1Str = shiftOneYearBackStr(dayBeforeYesterdayStrUTC); // borne GSC N-1 = (today-2) - 1 an

    const minDate = (a: string, b: string) => (a < b ? a : b);

    // GA4 : ne pas afficher le jour en cours => borne au plus tard = J-1
    // GSC : ne pas afficher le jour en cours + veille => borne au plus tard = J-2
    const getLastPromiseDate = async (from: string, to: string) => {
      const rows = await revenueCol.aggregate([
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
            _effectiveDate: { $gte: from, $lte: to },
            ...siteMatch,
            $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
          },
        },
        { $group: { _id: null, max: { $max: '$_effectiveDate' } } },
      ]).toArray();
      const v = rows[0]?.max;
      return v ? String(v) : null;
    };

    const [lastTraffic, lastGsc, lastTrafficN1, lastGscN1, lastPromises, lastPromisesN1] = await Promise.all([
      getLastDate(trafficCol, start, end),
      getLastDate(gscCol, start, end),
      getLastDate(trafficCol, n1Start, n1End),
      getLastDate(gscCol, n1Start, n1End),
      getLastPromiseDate(start, end),
      getLastPromiseDate(n1Start, n1End),
    ]);

    const trafficEndEff = minDate(lastTraffic ?? end, yesterdayStrUTC);
    const gscEndEff = minDate(lastGsc ?? end, dayBeforeYesterdayStrUTC);
    const promisesEndEff = minDate(lastPromises ?? end, yesterdayStrUTC);

    const trafficN1EndEff = minDate(lastTrafficN1 ?? n1End, yesterdayN1Str);
    const gscN1EndEff = minDate(lastGscN1 ?? n1End, dayBeforeYesterdayN1Str);
    const promisesN1EndEff = minDate(lastPromisesN1 ?? n1End, yesterdayN1Str);

    const diffDays = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
    const forceDay =
      periodType === 'week' || periodType === 'month' || periodType === 'year';
    const granularity = forceDay ? 'day' : diffDays <= 60 ? 'day' : 'month';
    const slice = granularity === 'month' ? 7 : 10;

    const shiftKeyYearBack = (key: string, gran: 'day' | 'month') => {
      if (gran === 'month') {
        const [y, m] = key.split('-').map((x) => parseInt(x, 10));
        const dt = new Date(Date.UTC(y, m - 1, 1));
        dt.setUTCFullYear(dt.getUTCFullYear() - 1);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      }
      const dt = new Date(key + 'T00:00:00Z');
      dt.setUTCFullYear(dt.getUTCFullYear() - 1);
      return dt.toISOString().slice(0, 10);
    };

    const [trafficCur, trafficN1, gscCur, gscN1, promisesCur, promisesN1] = await Promise.all([
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: trafficEndEff }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, sessions: { $sum: '$sessions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('traffic_daily').aggregate([
        { $match: { dateStr: { $gte: n1Start, $lte: trafficN1EndEff }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, sessions: { $sum: '$sessions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: start, $lte: gscEndEff }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, clicks: { $sum: '$clicks' }, impressions: { $sum: '$impressions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('gsc_daily').aggregate([
        { $match: { dateStr: { $gte: n1Start, $lte: gscN1EndEff }, ...siteMatch } },
        { $group: { _id: { $substr: ['$dateStr', 0, slice] }, clicks: { $sum: '$clicks' }, impressions: { $sum: '$impressions' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      revenueCol.aggregate([
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
            _effectiveDate: { $gte: start, $lte: promisesEndEff },
            ...siteMatch,
            $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
          },
        },
        { $group: { _id: { $substr: ['$_effectiveDate', 0, slice] }, total: { $sum: '$commissionActual' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      revenueCol.aggregate([
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
            _effectiveDate: { $gte: n1Start, $lte: promisesN1EndEff },
            ...siteMatch,
            $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
          },
        },
        { $group: { _id: { $substr: ['$_effectiveDate', 0, slice] }, total: { $sum: '$commissionActual' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
    ]);

    const keys = new Set<string>();
    [...trafficCur, ...gscCur, ...promisesCur].forEach((r) => keys.add(r._id));
    const sortedKeys = Array.from(keys).sort();

    const tcMap  = new Map(trafficCur.map((r) => [r._id, r.sessions]));
    const gcMap  = new Map(gscCur.map((r) => [r._id, { clicks: r.clicks, impressions: r.impressions }]));
    const tn1Map  = new Map(trafficN1.map((r) => [r._id, r.sessions]));
    const gn1Map  = new Map(gscN1.map((r) => [r._id, { clicks: r.clicks, impressions: r.impressions }]));
    const pcMap  = new Map(promisesCur.map((r) => [r._id, Math.round(Number(r.total ?? 0) * 100) / 100]));
    const pn1Map = new Map(promisesN1.map((r) => [r._id, Math.round(Number(r.total ?? 0) * 100) / 100]));

    const shiftGran: 'day' | 'month' = granularity === 'month' ? 'month' : 'day';

    // Pour éviter les courbes "flanchantes" dues aux jours incomplets :
    // On ne renvoie déjà pas ces jours via les bornes d'agrégation.
    const points = sortedKeys.map((key) => ({
      key,
      sessions: tcMap.get(key) ?? null,
      sessionsPY: tn1Map.get(shiftKeyYearBack(key, shiftGran)) ?? null,
      clicks: gcMap.get(key)?.clicks ?? null,
      clicksPY: gn1Map.get(shiftKeyYearBack(key, shiftGran))?.clicks ?? null,
      impressions: gcMap.get(key)?.impressions ?? null,
      impressionsPY: gn1Map.get(shiftKeyYearBack(key, shiftGran))?.impressions ?? null,
      promises: pcMap.get(key) ?? null,
      promisesPY: pn1Map.get(shiftKeyYearBack(key, shiftGran)) ?? null,
    }));

    return NextResponse.json({ granularity, periodType, points });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[OVERVIEW/CHART]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
