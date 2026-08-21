/**
 * POST /api/trajectory/analyze
 *
 * Lance une analyse de trajectoire. Si la file BullMQ est configurée, le job part
 * au worker Railway (les deux passes avec raisonnement élevé prennent 2 à 4 min,
 * bien au-delà d'une fonction Vercel) et l'appelant suit l'avancement via
 * /api/ingest/jobs/:id. Sinon, exécution en direct — utilisable en local.
 *
 * Corps optionnel : { todayStr?: string, sansSuivi?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { enqueueTrajectoryAnalysis, ingestQueueEnabled } from '@/lib/jobs/ingest-queue';
import { runTrajectoryAnalysis } from '@/lib/jobs/run-trajectory-analysis';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const input = {
      todayStr: typeof body?.todayStr === 'string' ? body.todayStr : undefined,
      sansSuivi: body?.sansSuivi === true,
    };

    if (ingestQueueEnabled()) {
      const job = await enqueueTrajectoryAnalysis(input);
      return NextResponse.json({ queued: true, jobId: String(job.id) });
    }

    const result = await runTrajectoryAnalysis(input);
    return NextResponse.json({ queued: false, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TRAJECTORY/ANALYZE]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
