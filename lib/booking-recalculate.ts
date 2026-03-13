/**
 * Logique partagée de recalcul des commissions Booking.com
 * Appelée automatiquement après chaque import Booking ET via l'endpoint manuel.
 *
 * Règles de calcul du tier pour les enregistrements "Booked" :
 *
 *   ► Mois PASSÉ avec des stayed confirmés en base
 *       → on utilise le count réel de stayed → tier DÉFINITIF
 *
 *   ► Mois FUTUR (ou mois en cours sans stayed encore)
 *       → on utilise le count N-1 (même mois, année précédente) → tier ESTIMÉ
 *       → sera recorrigé automatiquement après chaque import futur
 */

import type { Db } from 'mongodb';
import { getBookingTier } from '@/lib/parsers/booking';

export interface RecalculateResult {
  recordsScanned: number;
  recordsUpdated: number;
  stayedMonths: number;
  monthSummary: MonthSummary[];
}

export interface MonthSummary {
  month: string;
  stayedCount: number;
  stayedSource: 'actual' | 'n1_estimate';
  tier: string;
  recordsUpdated: number;
  oldRevenue: number;
  newRevenue: number;
  delta: number;
}

export async function recalculateBookingCommissions(db: Db): Promise<RecalculateResult> {
  const col = db.collection('affiliation_revenue');

  // Mois courant format YYYY-MM (pour distinguer passé / futur)
  const currentMonth = new Date().toISOString().slice(0, 7);

  // 1. Stayed counts par mois de check-in (données réelles en base)
  const stayedAgg = await col.aggregate([
    { $match: { partner: 'booking', status: 'Stayed' } },
    { $group: { _id: { $substr: ['$dateStr', 0, 7] }, stayed: { $sum: 1 } } },
  ]).toArray();

  const stayedByMonth: Record<string, number> = Object.fromEntries(
    stayedAgg.map((r) => [r._id as string, r.stayed as number])
  );

  /**
   * Retourne le tier correct pour un mois de check-in donné :
   * - Mois passé avec stayed réels → tier définitif basé sur stayed actuels
   * - Mois futur ou sans stayed → tier estimé via N-1 (même mois, année -1)
   */
  const getTierForMonth = (month: string): { tier: number; source: 'actual' | 'n1_estimate' } => {
    const actualStayed = stayedByMonth[month] ?? 0;

    // Mois terminé avec des stayed confirmés → tier définitif
    if (month < currentMonth && actualStayed > 0) {
      return { tier: getBookingTier(actualStayed), source: 'actual' };
    }

    // Mois en cours avec déjà des stayed → semi-définitif (recorrigé plus tard)
    if (month === currentMonth && actualStayed > 0) {
      return { tier: getBookingTier(actualStayed), source: 'actual' };
    }

    // Mois futur ou sans données → estimation N-1
    const [year, mo] = month.split('-');
    const n1Month    = `${parseInt(year) - 1}-${mo}`;
    const n1Stayed   = stayedByMonth[n1Month] ?? 0;
    return { tier: getBookingTier(n1Stayed), source: 'n1_estimate' };
  };

  // 2. Récupérer uniquement les "Booked" (réservations dont le tier est estimé)
  // Les "Stayed" ont une commission FINALE confirmée par Booking.com → ne pas toucher
  const records = await col.find({
    partner: 'booking',
    commissionMin: { $gt: 0 },
    status: { $in: ['Booked', 'booked'] },
  }).toArray();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = [];
  const summary: Record<string, {
    count: number;
    oldRevenue: number;
    newRevenue: number;
    source: 'actual' | 'n1_estimate';
  }> = {};

  for (const rec of records) {
    const month = (rec.dateStr as string).slice(0, 7);
    const { tier, source } = getTierForMonth(month);
    const newCommission = Math.round((rec.commissionMin as number) * (tier / 0.25) * 100) / 100;

    if (Math.abs(newCommission - (rec.commissionActual as number)) < 0.01) continue;

    ops.push({
      updateOne: {
        filter: { _id: rec._id },
        update: { $set: { commissionActual: newCommission, updatedAt: new Date() } },
      },
    });

    if (!summary[month]) summary[month] = { count: 0, oldRevenue: 0, newRevenue: 0, source };
    summary[month].count++;
    summary[month].oldRevenue += rec.commissionActual as number;
    summary[month].newRevenue += newCommission;
  }

  let updated = 0;
  if (ops.length > 0) {
    const result = await col.bulkWrite(ops);
    updated = result.modifiedCount;
  }

  const monthSummary: MonthSummary[] = Object.entries(summary)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, s]) => {
      const { tier, source } = getTierForMonth(month);
      const stayedCount = source === 'actual'
        ? (stayedByMonth[month] ?? 0)
        : (() => {
            const [y, mo] = month.split('-');
            return stayedByMonth[`${parseInt(y) - 1}-${mo}`] ?? 0;
          })();
      return {
        month,
        stayedCount,
        stayedSource: source,
        tier: `${Math.round(tier * 100)}%`,
        recordsUpdated: s.count,
        oldRevenue: Math.round(s.oldRevenue * 100) / 100,
        newRevenue: Math.round(s.newRevenue * 100) / 100,
        delta: Math.round((s.newRevenue - s.oldRevenue) * 100) / 100,
      };
    });

  return {
    recordsScanned: records.length,
    recordsUpdated: updated,
    stayedMonths: Object.keys(stayedByMonth).length,
    monthSummary,
  };
}
