import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';
import type { AffiliationPartner } from '@/lib/models/revenue';

type MappingKind = 'affiliateId' | 'productName';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const partner = body.partner as AffiliationPartner;
    const mappingKind = body.mappingKind as MappingKind;
    const mappingKey = String(body.mappingKey ?? '');
    const targetSiteName = String(body.siteName ?? '').trim();

    const periodType = body.periodType as string;
    const periodValue = body.periodValue as string | undefined;
    const customStart = body.start as string | undefined;
    const customEnd = body.end as string | undefined;
    const todayStr = body.today as string | undefined;

    if (!partner || !mappingKey || !targetSiteName) {
      return NextResponse.json({ error: 'Paramètres invalides (partner, mappingKey, siteName) requis' }, { status: 400 });
    }

    const { startStr, endStr } = resolvePeriod(periodType || 'month', periodValue, customStart, customEnd, todayStr);

    const db = await getDatabase();
    const col = db.collection('affiliation_revenue');

    const cancelFilter = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };
    const unassignedSiteFilter = {
      $or: [{ siteName: { $exists: false } }, { siteName: null }, { siteName: '' }],
    };

    const mappingFilter = mappingKind === 'affiliateId'
      ? { affiliateId: mappingKey }
      : { productName: mappingKey };

    // Filtre "promesses" (effective date) via $expr pour Booking vs autres
    const effectiveDateExpr = {
      $cond: [
        { $and: [{ $eq: ['$partner', 'booking'] }, { $gt: ['$bookingDateStr', null] }] },
        '$bookingDateStr',
        '$dateStr',
      ],
    };

    const res = await col.updateMany(
      {
        partner,
        commissionActual: { $gt: 0 },
        ...cancelFilter,
        ...unassignedSiteFilter,
        ...mappingFilter,
        $expr: {
          $and: [
            { $gte: [effectiveDateExpr, startStr] },
            { $lte: [effectiveDateExpr, endStr] },
          ],
        },
      },
      { $set: { siteName: targetSiteName } },
    );

    return NextResponse.json({
      updatedCount: res.modifiedCount ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PROMISES/NON-ATTRIBUTED/ASSIGN]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

