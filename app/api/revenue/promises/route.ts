/**
 * GET /api/revenue/promises
 *
 * Table "Promesses par plateforme" :
 *   - Booking.com  → filtré par bookingDateStr  (date à laquelle la réservation a été faite)
 *   - Autres       → filtré par dateStr          (date de transaction, déjà = date de commande)
 *
 * Retourne la même structure que byPartnerTable de /api/revenue/stats
 * mais avec la logique de date de réservation pour Booking.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';

function shiftYearBack(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

const PARTNERS = ['getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl'];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodType  = searchParams.get('periodType')  || 'month';
    const periodValue = searchParams.get('periodValue');
    const customStart = searchParams.get('start');
    const customEnd   = searchParams.get('end');
    const siteFilter  = searchParams.get('site');

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
    const n1EndStr   = shiftYearBack(endStr);

    const db  = await getDatabase();
    const col = db.collection('affiliation_revenue');

    // Pipeline qui utilise bookingDateStr pour Booking, dateStr pour les autres
    const makeMatchPipeline = (start: string, end: string) => [
      {
        $addFields: {
          _effectiveDate: {
            $cond: {
              if: { $and: [
                { $eq: ['$partner', 'booking'] },
                { $gt: ['$bookingDateStr', null] },
              ]},
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

    const nonCancelFilter = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };
    const cancelFilter    = { status: /cancel/i };

    // ── Revenus (hors annulés) ────────────────────────────────────────────────
    const revenueRows = await col.aggregate([
      ...makeMatchPipeline(startStr, endStr),
      { $match: nonCancelFilter },
      { $group: { _id: '$partner', total: { $sum: '$commissionActual' } } },
    ]).toArray();

    // ── N-1 revenus ───────────────────────────────────────────────────────────
    const revenueN1Rows = await col.aggregate([
      ...makeMatchPipeline(n1StartStr, n1EndStr),
      { $match: nonCancelFilter },
      { $group: { _id: '$partner', total: { $sum: '$commissionActual' } } },
    ]).toArray();

    // ── Annulés ───────────────────────────────────────────────────────────────
    const cancelRows = await col.aggregate([
      ...makeMatchPipeline(startStr, endStr),
      { $match: cancelFilter },
      { $group: { _id: '$partner', count: { $sum: 1 }, lostRevenue: { $sum: '$commissionMin' } } },
    ]).toArray();

    // ── Total (annulés + non-annulés) ─────────────────────────────────────────
    const totalRows = await col.aggregate([
      ...makeMatchPipeline(startStr, endStr),
      { $group: { _id: '$partner', total: { $sum: 1 } } },
    ]).toArray();

    // ── N-1 : annulés + total (pour le taux d'annulation N-1) ────────────────
    const cancelN1Rows = await col.aggregate([
      ...makeMatchPipeline(n1StartStr, n1EndStr),
      { $match: cancelFilter },
      { $group: { _id: '$partner', count: { $sum: 1 } } },
    ]).toArray();

    const totalN1Rows = await col.aggregate([
      ...makeMatchPipeline(n1StartStr, n1EndStr),
      { $group: { _id: '$partner', total: { $sum: 1 } } },
    ]).toArray();

    const revenueMap   = Object.fromEntries(revenueRows.map((r)  => [r._id, Math.round(r.total * 100) / 100]));
    const revenueN1Map = Object.fromEntries(revenueN1Rows.map((r) => [r._id, Math.round(r.total * 100) / 100]));
    const cancelMap    = Object.fromEntries(cancelRows.map((r)   => [r._id, { count: r.count as number, lostRevenue: (r.lostRevenue ?? 0) as number }]));
    const totalMap     = Object.fromEntries(totalRows.map((r)    => [r._id, r.total as number]));
    const cancelN1Map  = Object.fromEntries(cancelN1Rows.map((r) => [r._id, r.count as number]));
    const totalN1Map   = Object.fromEntries(totalN1Rows.map((r)  => [r._id, r.total as number]));

    const byPartnerTable = PARTNERS.map((id) => {
      const revenue       = revenueMap[id]   ?? 0;
      const revenueN1     = revenueN1Map[id] ?? 0;
      const cancelledInfo = cancelMap[id]    ?? { count: 0, lostRevenue: 0 };
      const total         = totalMap[id]     ?? 0;
      const cancelledN1   = cancelN1Map[id]  ?? 0;
      const totalN1       = totalN1Map[id]   ?? 0;

      const cancelRate   = total   > 0 ? Math.round((cancelledInfo.count / total)   * 1000) / 10 : null;
      const cancelRateN1 = totalN1 > 0 ? Math.round((cancelledN1        / totalN1) * 1000) / 10 : null;

      const evolution = revenueN1 > 0
        ? Math.round(((revenue - revenueN1) / revenueN1) * 1000) / 10
        : revenue > 0 ? null : null;

      return {
        partner: id,
        revenue,
        revenueN1,
        evolution,
        bookingsTotal:  total,
        cancelledCount: cancelledInfo.count,
        cancelRate,
        cancelRateN1,
      };
    // Ne pas masquer un partenaire si le revenu N existe (cas courant : bookingTotal agrégé à 0 par incohérence de données)
    }).filter((r) => r.bookingsTotal > 0 || r.revenue > 0 || r.revenueN1 > 0);

    const totalRevenue    = byPartnerTable.reduce((s, r) => s + r.revenue, 0);
    const totalCancelled  = byPartnerTable.reduce((s, r) => s + r.cancelledCount, 0);

    return NextResponse.json({
      startStr,
      endStr,
      byPartnerTable,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCancelled,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
