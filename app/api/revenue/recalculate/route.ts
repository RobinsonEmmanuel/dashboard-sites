import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { recalculateBookingCommissions } from '@/lib/booking-recalculate';

export async function POST() {
  try {
    const db     = await getDatabase();
    const result = await recalculateBookingCommissions(db);
    return NextResponse.json({
      message: `${result.recordsUpdated} enregistrements Booking mis à jour`,
      ...result,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
