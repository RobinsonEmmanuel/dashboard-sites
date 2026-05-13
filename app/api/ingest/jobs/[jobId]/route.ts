import { NextRequest, NextResponse } from 'next/server';
import { ingestQueueEnabled, getIngestJobState } from '@/lib/jobs/ingest-queue';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!ingestQueueEnabled()) {
      return NextResponse.json({ error: 'File d’ingestion non configurée' }, { status: 503 });
    }
    const { jobId } = await ctx.params;
    const state = await getIngestJobState(jobId);
    if (!state) {
      return NextResponse.json({ error: 'Job introuvable' }, { status: 404 });
    }
    return NextResponse.json(state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
