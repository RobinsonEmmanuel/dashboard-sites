/**
 * POST /api/editorial/import
 *
 * Importe le tableau de production éditoriale (Google Sheets) dans MongoDB.
 * Corps optionnel : { todayStr?: string, dryRun?: boolean, sync?: boolean }
 *
 * `dryRun: true` lit et analyse le tableau sans rien écrire — à utiliser dès que la
 * structure du tableau a pu bouger : la réponse liste les semaines comprises, les
 * destinations rattachées ou non, et tout ce que le parseur n'a pas su lire.
 *
 * L'import est court (une requête HTTP + un bulkWrite) : il tourne en direct par
 * défaut, et passe par la file seulement si on le demande explicitement.
 */

import { NextRequest, NextResponse } from 'next/server';
import { enqueueEditorialImport, ingestQueueEnabled } from '@/lib/jobs/ingest-queue';
import { runEditorialImport } from '@/lib/jobs/run-editorial-import';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const input = {
      todayStr: typeof body?.todayStr === 'string' ? body.todayStr : undefined,
      dryRun: body?.dryRun === true,
    };

    if (body?.sync === false && ingestQueueEnabled()) {
      const job = await enqueueEditorialImport(input);
      return NextResponse.json({ queued: true, jobId: String(job.id) });
    }

    const result = await runEditorialImport(input);
    return NextResponse.json({ queued: false, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[EDITORIAL/IMPORT]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET = dry run, pour inspecter la structure du tableau sans rien écrire. */
export async function GET(req: NextRequest) {
  try {
    const todayStr = new URL(req.url).searchParams.get('today') ?? undefined;
    const result = await runEditorialImport({ todayStr, dryRun: true });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[EDITORIAL/INSPECT]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
