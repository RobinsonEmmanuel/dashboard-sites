/**
 * GET /api/revenue/booking-monthly
 *
 * Revenus Booking.com réalisés par mois de check-out.
 * Un séjour est "réalisé" quand le voyageur a quitté le logement (check-out).
 * Booking.com verse la commission après le check-out.
 *
 * Retourne les 36 derniers mois de données.
 */

import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { getBookingTier } from '@/lib/parsers/booking';

const FR_MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

export async function GET() {
  try {
    const db  = await getDatabase();
    const col = db.collection('affiliation_revenue');

    // Revenus par mois de check-out (non-annulés uniquement)
    const revenueAgg = await col.aggregate([
      {
        $match: {
          partner: 'booking',
          checkOutDateStr: { $exists: true, $ne: '' },
          $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }],
        },
      },
      {
        $group: {
          _id: { $substr: ['$checkOutDateStr', 0, 7] },
          revenue:    { $sum: '$commissionActual' },
          bookings:   { $sum: 1 },
          stayed:     { $sum: { $cond: [{ $eq: ['$status', 'Stayed'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    // Stayed par mois de check-in (pour afficher le tier dans la modale)
    const stayedAgg = await col.aggregate([
      { $match: { partner: 'booking', status: 'Stayed' } },
      { $group: { _id: { $substr: ['$dateStr', 0, 7] }, stayed: { $sum: 1 } } },
    ]).toArray();
    const stayedByCheckIn = Object.fromEntries(stayedAgg.map((r) => [r._id, r.stayed as number]));

    const rows = revenueAgg.map((r) => {
      const month    = r._id as string;
      const [y, m]   = month.split('-');
      const monthIdx = parseInt(m) - 1;
      const tier     = getBookingTier(stayedByCheckIn[month] ?? 0);
      return {
        month,
        monthLabel: `${FR_MONTHS[monthIdx]} ${y}`,
        revenue:    Math.round((r.revenue as number) * 100) / 100,
        bookings:   r.bookings as number,
        stayed:     r.stayed as number,
        tier:       `${Math.round(tier * 100)}%`,
        tierPct:    tier,
      };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
