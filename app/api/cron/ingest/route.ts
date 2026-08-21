import { NextRequest, NextResponse } from 'next/server';
import { ingestQueueEnabled, enqueueGa4Ingest, enqueueGscIngest, enqueueEditorialImport } from '@/lib/jobs/ingest-queue';

/**
 * GET /api/cron/ingest
 *
 * Déclenché automatiquement par Vercel Cron Jobs (vercel.json).
 * Vercel envoie automatiquement : Authorization: Bearer <CRON_SECRET>
 *
 * Si BULLMQ_REDIS_URL est défini : enfile GA4 + GSC + import du tableau éditorial
 * (traitement par le worker Railway).
 * Sinon : déclenche les routes d’ingestion HTTP sur ce déploiement (comportement historique).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  if (ingestQueueEnabled()) {
    const [ga4Job, gscJob, editoJob] = await Promise.all([
      enqueueGa4Ingest({ mode: 'incremental' }),
      enqueueGscIngest({ mode: 'incremental' }),
      // Le tableau éditorial est tenu à la main et bouge tous les jours : import quotidien.
      enqueueEditorialImport({}),
    ]);
    const durationMs = Date.now() - startTime;
    return NextResponse.json({
      success: true,
      queued: true,
      durationMs,
      ga4JobId: String(ga4Job.id),
      gscJobId: String(gscJob.id),
      editorialJobId: String(editoJob.id),
    });
  }

  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? `https://${process.env.VERCEL_URL}`;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  };

  const body = JSON.stringify({ mode: 'incremental' });

  const [gscRes, ga4Res, editoRes] = await Promise.allSettled([
    fetch(`${host}/api/ingest/gsc`, { method: 'POST', headers, body }),
    fetch(`${host}/api/ingest/ga4`, { method: 'POST', headers, body }),
    fetch(`${host}/api/editorial/import`, { method: 'POST', headers, body: '{}' }),
  ]);

  const parseResult = async (
    settled: PromiseSettledResult<Response>,
    label: string
  ) => {
    if (settled.status === 'rejected') {
      console.error(`[CRON] ${label} fetch error:`, settled.reason);
      return { ok: false, error: String(settled.reason) };
    }
    const res = settled.value;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[CRON] ${label} HTTP ${res.status}:`, data);
    }
    return { ok: res.ok, status: res.status, ...data };
  };

  const [gsc, ga4, editorial] = await Promise.all([
    parseResult(gscRes, 'GSC'),
    parseResult(ga4Res, 'GA4'),
    parseResult(editoRes, 'Tableau éditorial'),
  ]);

  const durationMs = Date.now() - startTime;
  const success = gsc.ok && ga4.ok;

  console.log(`[CRON] Ingestion terminée en ${durationMs}ms — GSC: ${gsc.ok ? 'OK' : 'ERREUR'} | GA4: ${ga4.ok ? 'OK' : 'ERREUR'}`);

  return NextResponse.json(
    { success, durationMs, gsc, ga4, editorial },
    { status: success ? 200 : 207 }
  );
}
