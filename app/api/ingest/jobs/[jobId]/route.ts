import { NextRequest, NextResponse } from 'next/server';
import { ingestQueueEnabled, getIngestJobState, getIngestQueue } from '@/lib/jobs/ingest-queue';

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

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!ingestQueueEnabled()) {
      return NextResponse.json({ error: 'File d’ingestion non configurée' }, { status: 503 });
    }
    const { jobId } = await ctx.params;
    const queue = getIngestQueue();
    const job = await queue.getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job introuvable' }, { status: 404 });
    }
    const st = await job.getState();
    if (st === 'completed' || st === 'failed') {
      return NextResponse.json({ error: 'Le job est déjà terminé.' }, { status: 400 });
    }
    try {
      await job.remove();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('locked')) {
        return NextResponse.json(
          {
            error:
              'Job en cours sur le worker — impossible de le retirer tout de suite. Réessayez dans quelques secondes.',
          },
          { status: 409 },
        );
      }
      throw err;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
