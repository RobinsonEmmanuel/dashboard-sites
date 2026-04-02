import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';
import { buildAffiliateMaps } from '@/lib/affiliate-maps';
import type { AffiliationPartner } from '@/lib/models/revenue';

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

    const { startStr, endStr } = resolvePeriod(periodType, periodValue, customStart, customEnd);

    const db = await getDatabase();
    const col = db.collection('affiliation_revenue');

    const affiliateMaps = await buildAffiliateMaps(db);

    // mapping sendowl productName -> siteName
    const soProducts = await db.collection('sendowl_products').find({}).toArray();
    const productNameMap: Record<string, string> = {};
    for (const p of soProducts) {
      if (p.productName && p.siteName) productNameMap[p.productName] = p.siteName;
    }

    const cancelFilter = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };
    const unassignedSiteFilter = {
      $or: [
        { siteName: { $exists: false } },
        { siteName: null },
        { siteName: '' },
      ],
    };

    const filter = {
      partner: { $in: PARTNERS },
      dateStr: { $gte: startStr, $lte: endStr },
      commissionActual: { $gt: 0 },
      ...cancelFilter,
      ...unassignedSiteFilter,
    };

    const cursor = col.find(filter, {
      projection: { partner: 1, affiliateId: 1, productName: 1, siteName: 1 },
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
    let ops: any[] = [];

    const flush = async () => {
      if (!ops.length) return;
      const bulkRes = await col.bulkWrite(ops, { ordered: false });
      const mod = bulkRes.modifiedCount ?? 0;
      updated += mod;

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
        // répartition par partenaire (sans coût supplémentaire)
        updatedByPartner[partner] += 1;
      }

      if (ops.length >= batchSize) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
    console.error('[NON-ATTRIBUTED/AUTO-ASSIGN]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

