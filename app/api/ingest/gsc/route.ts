import { NextRequest, NextResponse } from 'next/server';
import { ingestQueueEnabled, enqueueGscIngest } from '@/lib/jobs/ingest-queue';
import { runGscIngest, type GscIngestMode } from '@/lib/jobs/run-gsc-ingest';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: GscIngestMode = body.mode ?? 'smart';
    const forceInline = body.inline === true;

    if (ingestQueueEnabled() && !forceInline) {
      const job = await enqueueGscIngest({ mode });
      return NextResponse.json(
        { queued: true, jobId: String(job.id), message: 'Job placé en file (worker Railway).' },
        { status: 202 },
      );
    }

    const result = await runGscIngest({ mode });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = msg.includes('Aucun site actif') ? 404 : 500;
    console.error('[GSC] Erreur générale:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
