import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { getBookingTier } from '@/lib/parsers/booking';

const FR_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

export async function GET() {
  try {
    const db  = await getDatabase();
    const col = db.collection('affiliation_revenue');

    const currentYear = new Date().getFullYear();
    const yearN  = currentYear;
    const yearN1 = currentYear - 1;
    const yearN2 = currentYear - 2;

    // Stayed counts par mois YYYY-MM
    const stayedAgg = await col.aggregate([
      { $match: { partner: 'booking', status: 'Stayed' } },
      { $group: { _id: { $substr: ['$dateStr', 0, 7] }, stayed: { $sum: 1 } } },
    ]).toArray();

    const stayedMap: Record<string, number> = Object.fromEntries(
      stayedAgg.map((r) => [r._id as string, r.stayed as number])
    );

    const rows = Array.from({ length: 12 }, (_, i) => {
      const m      = String(i + 1).padStart(2, '0');
      const sN     = stayedMap[`${yearN}-${m}`]  ?? 0;
      const sN1    = stayedMap[`${yearN1}-${m}`] ?? 0;
      const sN2    = stayedMap[`${yearN2}-${m}`] ?? 0;
      return {
        monthIndex: i + 1,
        monthLabel: FR_MONTHS[i],
        stayedN:    sN,
        stayedN1:   sN1,
        stayedN2:   sN2,
        tierN:   sN  > 0 ? `${Math.round(getBookingTier(sN)  * 100)}%` : null,
        tierN1:  sN1 > 0 ? `${Math.round(getBookingTier(sN1) * 100)}%` : null,
        tierN2:  sN2 > 0 ? `${Math.round(getBookingTier(sN2) * 100)}%` : null,
      };
    });

    return NextResponse.json({ yearN, yearN1, yearN2, rows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
