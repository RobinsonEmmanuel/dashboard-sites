/**
 * GET  /api/veille          — les faits externes connus, retenus ou écartés.
 * POST /api/veille          — relance une veille (recherche web sourcée).
 *
 * La veille passe par la file quand elle est disponible : la recherche web plus le
 * raisonnement dépassent la durée d'une fonction Vercel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { enqueueVeille, ingestQueueEnabled } from '@/lib/jobs/ingest-queue';
import { runVeille } from '@/lib/jobs/run-veille';
import { dateDerniereVeille, listerVeille } from '@/lib/trajectory/veille-store';

export const maxDuration = 300;

export async function GET() {
  try {
    const [evenements, derniere] = await Promise.all([listerVeille(), dateDerniereVeille()]);
    return NextResponse.json({ derniere_veille: derniere, evenements });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[VEILLE] GET', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const input = {
      todayStr: typeof body?.todayStr === 'string' ? body.todayStr : undefined,
      moisCouverts: typeof body?.moisCouverts === 'number' ? body.moisCouverts : undefined,
    };

    if (ingestQueueEnabled()) {
      const job = await enqueueVeille(input);
      return NextResponse.json({ queued: true, jobId: String(job.id) });
    }
    const result = await runVeille(input);
    return NextResponse.json({ queued: false, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[VEILLE] POST', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
