import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';

/** Décale une date YYYY-MM-DD d'exactement un an en arrière */
function shiftYearBack(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodType  = searchParams.get('periodType')  || 'month';
    const periodValue = searchParams.get('periodValue');
    const customStart = searchParams.get('start');
    const customEnd   = searchParams.get('end');
    const siteFilter  = searchParams.get('site');

    const { startStr, endStr, label } = resolvePeriod(periodType, periodValue, customStart, customEnd);

    const db  = await getDatabase();
    const col = db.collection('affiliation_revenue');
    const trafficCol = db.collection('traffic_daily');

    const revenueMatch: Record<string, unknown> = {
      dateStr: { $gte: startStr, $lte: endStr },
      // Exclure les annulés du calcul de revenu
      $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
    };
    if (siteFilter) revenueMatch.siteName = siteFilter;

    // Aggregate par partenaire
    const byPartner = await col.aggregate([
      { $match: revenueMatch },
      { $group: { _id: '$partner', total: { $sum: '$commissionActual' } } },
    ]).toArray();

    // Aggregate par site
    const bySite = await col.aggregate([
      { $match: revenueMatch },
      { $group: { _id: '$siteName', total: { $sum: '$commissionActual' } } },
      { $sort: { total: -1 } },
    ]).toArray();

    // ── Revenus N-1 par partenaire (même période, année précédente) ───────────
    const n1StartStr = shiftYearBack(startStr);
    const n1EndStr   = shiftYearBack(endStr);
    const revenueMatchN1: Record<string, unknown> = {
      dateStr: { $gte: n1StartStr, $lte: n1EndStr },
      $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
    };
    if (siteFilter) revenueMatchN1.siteName = siteFilter;

    const byPartnerN1 = await col.aggregate([
      { $match: revenueMatchN1 },
      { $group: { _id: '$partner', total: { $sum: '$commissionActual' } } },
    ]).toArray();
    const partnerN1Map: Record<string, number> = Object.fromEntries(byPartnerN1.map((p) => [p._id, Math.round(p.total * 100) / 100]));

    // ── Annulés par partenaire ────────────────────────────────────────────────
    const cancelledMatchBase: Record<string, unknown> = {
      dateStr: { $gte: startStr, $lte: endStr },
      status: /cancel/i,
    };
    if (siteFilter) cancelledMatchBase.siteName = siteFilter;
    const cancelledCount = await col.countDocuments(cancelledMatchBase);

    // Annulés par partenaire (count + montant potentiel perdu)
    const cancelledByPartner = await col.aggregate([
      { $match: cancelledMatchBase },
      { $group: { _id: '$partner', count: { $sum: 1 }, lostRevenue: { $sum: '$commissionMin' } } },
    ]).toArray();

    // Total bookings (annulés + non-annulés) par partenaire pour taux d'annulation
    const totalByPartner = await col.aggregate([
      { $match: { dateStr: { $gte: startStr, $lte: endStr }, ...(siteFilter ? { siteName: siteFilter } : {}) } },
      { $group: { _id: '$partner', total: { $sum: 1 } } },
    ]).toArray();

    // Sessions pour calcul RPM — on filtre par dateStr (string) et shortName (= siteName dans revenue)
    const trafficMatch: Record<string, unknown> = {
      dateStr: { $gte: startStr, $lte: endStr },
    };
    if (siteFilter) trafficMatch.shortName = siteFilter;

    const sessionsAgg = await trafficCol.aggregate([
      { $match: trafficMatch },
      { $group: { _id: null, total: { $sum: '$sessions' } } },
    ]).toArray();
    const totalSessions = sessionsAgg[0]?.total ?? 0;

    const totalRevenue = byPartner.reduce((sum, p) => sum + p.total, 0);

    // RPM par site — grouper par shortName pour que le join avec revenue (siteName = shortName) fonctionne
    const siteSessionsAgg = await trafficCol.aggregate([
      { $match: trafficMatch },
      { $group: { _id: '$shortName', sessions: { $sum: '$sessions' } } },
    ]).toArray();
    const siteSessionsMap = Object.fromEntries(siteSessionsAgg.map((s) => [s._id, s.sessions]));

    const bySiteWithRpm = bySite.map((s) => {
      const sessions = siteSessionsMap[s._id] ?? 0;
      return {
        siteName: s._id ?? 'Non attribué',
        revenue:  Math.round(s.total * 100) / 100,
        sessions,
        rpm: sessions > 0 ? Math.round((s.total / sessions) * 1000 * 100) / 100 : null,
      };
    });

    // Construire la map partenaire enrichie
    const cancelledMap = Object.fromEntries(cancelledByPartner.map((p) => [p._id, { count: p.count, lostRevenue: p.lostRevenue ?? 0 }]));
    const totalMap     = Object.fromEntries(totalByPartner.map((p) => [p._id, p.total]));

    const PARTNER_IDS = ['getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl'];
    const partnerMap: Record<string, number> = Object.fromEntries(PARTNER_IDS.map((id) => [id, 0]));
    for (const p of byPartner) {
      partnerMap[p._id] = Math.round(p.total * 100) / 100;
    }

    const byPartnerTable = PARTNER_IDS.map((id) => {
      const revenue       = partnerMap[id] ?? 0;
      const revenueN1     = partnerN1Map[id] ?? 0;
      const cancelledInfo = cancelledMap[id] ?? { count: 0, lostRevenue: 0 };
      const total         = totalMap[id] ?? 0;
      const cancelRate    = total > 0 ? Math.round((cancelledInfo.count / total) * 1000) / 10 : null;
      const evolution     = revenueN1 > 0
        ? Math.round(((revenue - revenueN1) / revenueN1) * 1000) / 10
        : revenue > 0 ? null  // N-1 = 0 mais N > 0 → nouveau, on renvoie null
        : null;
      return {
        partner: id,
        revenue,
        revenueN1,
        evolution,       // % vs N-1, null si N-1 inconnu
        bookingsTotal: total,
        cancelledCount: cancelledInfo.count,
        cancelRate,
      };
    }).filter((r) => r.bookingsTotal > 0 || r.revenueN1 > 0);

    return NextResponse.json({
      periodType,
      periodValue,
      startStr,
      endStr,
      n1StartStr,
      n1EndStr,
      label,
      totalRevenue:   Math.round(totalRevenue * 100) / 100,
      totalSessions,
      cancelledCount,
      rpm: totalSessions > 0 ? Math.round((totalRevenue / totalSessions) * 1000 * 100) / 100 : null,
      byPartner:      partnerMap,
      byPartnerTable,
      bySite:         bySiteWithRpm,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
