import { NextRequest, NextResponse } from 'next/server';
import { ingestQueueEnabled, enqueueGa4Ingest } from '@/lib/jobs/ingest-queue';
import { runGa4Ingest, type Ga4IngestMode } from '@/lib/jobs/run-ga4-ingest';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: Ga4IngestMode = body.mode ?? 'smart';
    const siteId: string | undefined = body.siteId;
    const forceInline = body.inline === true;

    if (ingestQueueEnabled() && !forceInline) {
      const job = await enqueueGa4Ingest({ mode, siteId });
      return NextResponse.json(
        { queued: true, jobId: String(job.id), message: 'Job placé en file (worker Railway).' },
        { status: 202 },
      );
    }

    const result = await runGa4Ingest({ mode, siteId });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = msg.includes('Aucun site actif') ? 404 : 500;
    console.error('[GA4] Erreur générale:', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
