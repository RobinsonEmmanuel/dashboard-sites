import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';
import { buildAffiliateMaps } from '@/lib/affiliate-maps';
import type { AffiliationPartner } from '@/lib/models/revenue';
import type { AnyBulkWriteOperation } from 'mongodb';

export const maxDuration = 60; // Vercel Pro

const PARTNERS: AffiliationPartner[] = ['getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl'];
type PeriodType = 'week' | 'month' | 'year' | 'custom';

function normalizeSendowlItemNameForLookup(name: string): string {
  return name.replace(/\(x\d+\)$/, '(x1)').trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const periodType = (body.periodType as PeriodType) || 'month';
    const periodValue = body.periodValue as string | undefined;
    const customStart = body.start as string | undefined;
    const customEnd = body.end as string | undefined;
    const todayStr = body.today as string | undefined;

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

    const effectiveDateExpr = {
      $cond: [
        { $and: [{ $eq: ['$partner', 'booking'] }, { $gt: ['$bookingDateStr', null] }] },
        '$bookingDateStr',
        '$dateStr',
      ],
    };

    const filter = {
      partner: { $in: PARTNERS },
      commissionActual: { $gt: 0 },
      ...cancelFilter,
      ...unassignedSiteFilter,
      $expr: {
        $and: [
          { $gte: [effectiveDateExpr, startStr] },
          { $lte: [effectiveDateExpr, endStr] },
        ],
      },
    };

    const cursor = col.find(filter, {
      projection: { partner: 1, affiliateId: 1, productName: 1 },
    });

    let scanned = 0;
    let updated = 0;
    const updatedByPartner: Record<AffiliationPartner, number> = {
      getyourguide: 0,
      booking: 0,
      tiqets: 0,
      discovercars: 0,
      sendowl: 0,
    };

    const batchSize = 500;
    let ops: AnyBulkWriteOperation[] = [];

    const flush = async () => {
      if (!ops.length) return;
      const bulkRes = await col.bulkWrite(ops, { ordered: false });
      updated += bulkRes.modifiedCount ?? 0;
      ops = [];
    };

    for await (const doc of cursor as any) {
      scanned++;

      const partner = doc.partner as AffiliationPartner;
      const affiliateId = (doc.affiliateId ?? '').toString();
      const productName = (doc.productName ?? '').toString();

      let targetSiteName: string | undefined;
      if (partner === 'booking') targetSiteName = affiliateMaps.booking[affiliateId];
      else if (partner === 'getyourguide') targetSiteName = affiliateMaps.gyg[affiliateId];
      else if (partner === 'discovercars') targetSiteName = affiliateMaps.discovercars[affiliateId];
      else if (partner === 'tiqets') targetSiteName = affiliateMaps.tiqets[affiliateId];
      else if (partner === 'sendowl') {
        targetSiteName = productNameMap[productName] ?? productNameMap[normalizeSendowlItemNameForLookup(productName)];
      }

      if (targetSiteName) {
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { siteName: targetSiteName } },
          },
        });
        updatedByPartner[partner] += 1;
      }

      if (ops.length >= batchSize) {
        await flush();
      }
    }

    await flush();

    return NextResponse.json({
      periodType,
      startStr,
      endStr,
      scanned,
      updated,
      updatedByPartner,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PROMISES/NON-ATTRIBUTED/AUTO-ASSIGN]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

