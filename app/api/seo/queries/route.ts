import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId') ?? undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

    const db = await getDatabase();
    const match = siteId ? { siteId } : {};

    const queries = await db
      .collection('gsc_queries')
      .find(match)
      .sort({ clicks: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json(queries);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
