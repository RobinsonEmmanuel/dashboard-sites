import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';
import type { AffiliationPartner } from '@/lib/models/revenue';
import { buildAffiliateMaps } from '@/lib/affiliate-maps';

const PARTNERS: AffiliationPartner[] = ['getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl'];
type MappingKind = 'affiliateId' | 'productName';

export interface UnassignedGroup {
  partner: AffiliationPartner;
  mappingKind: MappingKind;
  mappingKey: string;
  reason: string;
  exampleReservationCity?: string;
  exampleReservationCountry?: string;
  revenue: number;
  count: number;
  exampleOrderId: string;
  exampleDateStr: string;
}

function normalizeSendowlItemNameForLookup(name: string): string {
  return name.replace(/\(x\d+\)$/, '(x1)').trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodType = searchParams.get('periodType') || 'month';
    const periodValue = searchParams.get('periodValue') ?? undefined;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd = searchParams.get('end') ?? undefined;
    const todayStr = searchParams.get('today') ?? undefined;
    const limit = Math.max(10, parseInt(searchParams.get('limit') || '200', 10));

    const { startStr, endStr } = resolvePeriod(periodType, periodValue, customStart, customEnd, todayStr);

    const db = await getDatabase();
    const col = db.collection('affiliation_revenue');

    const affiliateMaps = await buildAffiliateMaps(db);

    const soProducts = await db.collection('sendowl_products').find({}).toArray();
    const productNameMap: Record<string, string> = {};
    for (const p of soProducts) {
      if (p.productName && p.siteName) productNameMap[p.productName] = p.siteName;
    }

    const cancelFilter = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };
    const unassignedSiteFilter = {
      $or: [{ siteName: { $exists: false } }, { siteName: null }, { siteName: '' }],
    };

    const agg = await col.aggregate([
      // effective date for promises: bookingDateStr for booking when present else dateStr
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
          _effectiveDate: { $gte: startStr, $lte: endStr },
          partner: { $in: PARTNERS },
          commissionActual: { $gt: 0 },
          ...cancelFilter,
          ...unassignedSiteFilter,
        },
      },
      {
        $project: {
          partner: 1,
          affiliateId: 1,
          productName: 1,
          commissionActual: 1,
          orderId: 1,
          _effectiveDate: 1,
          reservationCity: 1,
          reservationCountry: 1,
          hasAffiliateId: {
            $gt: [{ $strLenCP: { $ifNull: ['$affiliateId', ''] } }, 0],
          },
        },
      },
      {
        $addFields: {
          mappingKind: { $cond: ['$hasAffiliateId', 'affiliateId', 'productName'] },
          mappingKey: { $cond: ['$hasAffiliateId', '$affiliateId', { $ifNull: ['$productName', ''] }] },
        },
      },
      { $match: { mappingKey: { $ne: '' } } },
      {
        $group: {
          _id: { partner: '$partner', mappingKind: '$mappingKind', mappingKey: '$mappingKey' },
          revenue: { $sum: '$commissionActual' },
          count: { $sum: 1 },
          exampleOrderId: { $first: '$orderId' },
          exampleDateStr: { $first: '$_effectiveDate' },
          exampleReservationCity: { $first: '$reservationCity' },
          exampleReservationCountry: { $first: '$reservationCountry' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]).toArray();

    const groups: UnassignedGroup[] = agg.map((g: any) => {
      const partner = g._id.partner as AffiliationPartner;
      const mappingKind = g._id.mappingKind as MappingKind;
      const mappingKey = String(g._id.mappingKey ?? '');

      let reason = 'Non attribué';
      if (mappingKind === 'affiliateId') {
        const mapped =
          partner === 'booking'
            ? affiliateMaps.booking[mappingKey]
            : partner === 'getyourguide'
              ? affiliateMaps.gyg[mappingKey]
              : partner === 'discovercars'
                ? affiliateMaps.discovercars[mappingKey]
                : partner === 'tiqets'
                  ? affiliateMaps.tiqets[mappingKey]
                  : undefined;

        reason = mapped
          ? 'Clé trouvée dans le mapping, mais `siteName` manquant (incohérence)'
          : `Clé non mappée (${partner} / ${mappingKey})`;
      } else {
        if (partner === 'sendowl') {
          const direct = productNameMap[mappingKey];
          const normalized = productNameMap[normalizeSendowlItemNameForLookup(mappingKey)];
          reason = direct || normalized
            ? 'Produit trouvé dans le mapping, mais `siteName` manquant (incohérence)'
            : `Produit non mappé (sendowl) : ${mappingKey}`;
        } else if (partner === 'tiqets') {
          reason = 'Campagne non mappée (historique sans `affiliateId` stocké)';
        } else {
          reason = 'Identifiant de mapping manquant (impossible de rattacher)';
        }
      }

      return {
        partner,
        mappingKind,
        mappingKey,
        reason,
        exampleReservationCity: g.exampleReservationCity ? String(g.exampleReservationCity) : undefined,
        exampleReservationCountry: g.exampleReservationCountry ? String(g.exampleReservationCountry) : undefined,
        revenue: Math.round((g.revenue ?? 0) * 100) / 100,
        count: g.count ?? 0,
        exampleOrderId: String(g.exampleOrderId ?? ''),
        exampleDateStr: String(g.exampleDateStr ?? ''),
      };
    });

    const groupsByPartner = Object.fromEntries(PARTNERS.map((p) => [p, [] as UnassignedGroup[]])) as Record<
      AffiliationPartner,
      UnassignedGroup[]
    >;
    for (const g of groups) groupsByPartner[g.partner].push(g);

    return NextResponse.json({
      periodType,
      periodValue,
      startStr,
      endStr,
      groupsByPartner,
      totalRevenue: groups.reduce((s, g) => s + g.revenue, 0),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PROMISES/NON-ATTRIBUTED]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

