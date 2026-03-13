import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId') ?? undefined;
    const minImpressions = parseInt(searchParams.get('minImpressions') ?? '500');
    const maxCtr = parseFloat(searchParams.get('maxCtr') ?? '0.03'); // 3%
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

    const db = await getDatabase();
    const match: Record<string, unknown> = {
      impressions: { $gte: minImpressions },
      ctr: { $lte: maxCtr },
    };
    if (siteId) match.siteId = siteId;

    const opportunities = await db
      .collection('gsc_pages')
      .find(match)
      .sort({ impressions: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json(opportunities);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
