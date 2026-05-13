/**
 * Worker Railway : file BullMQ `dashboard-ingest` (GA4, GSC, import CSV revenus).
 *
 * Variables d’environnement (mêmes que Vercel pour l’ingestion) :
 *   BULLMQ_REDIS_URL   — URL Redis Upstash (onglet « Redis », format rediss://)
 *   BULLMQ_PREFIX      — optionnel, défaut {dashboard-sites} (hash tag cluster Upstash)
 *   MONGODB_URI, MONGODB_DB_NAME
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
 *
 * Import CSV revenus : même MongoDB ; pas d’appel Google.
 */

import { Worker } from 'bullmq';
import { createBullmqConnection, bullmqPrefix } from '../../lib/jobs/redis-for-bullmq';
import { runGa4Ingest } from '../../lib/jobs/run-ga4-ingest';
import { runGscIngest } from '../../lib/jobs/run-gsc-ingest';
import { runRevenueCsvImport } from '../../lib/jobs/run-revenue-import';
import type { AffiliationPartner } from '../../lib/models/revenue';

/** Même valeur que `lib/jobs/ingest-queue-name.ts` (producers BullMQ côté Next). */
const INGEST_QUEUE_NAME = 'dashboard-ingest';

const connection = createBullmqConnection();

const worker = new Worker(
  INGEST_QUEUE_NAME,
  async (job) => {
    if (job.name === 'ga4') return await runGa4Ingest(job.data ?? {});
    if (job.name === 'gsc') return await runGscIngest(job.data ?? {});
    if (job.name === 'revenue-import') {
      const raw = (job.data ?? {}) as { text?: string; partner?: AffiliationPartner };
      const r = await runRevenueCsvImport({
        text: raw.text ?? '',
        partner: raw.partner ?? undefined,
      });
      if (!r.ok) return { _status: r.status, ...r.body };
      return r.body;
    }
    throw new Error(`Type de job inconnu : ${job.name}`);
  },
  {
    connection,
    prefix: bullmqPrefix(),
    concurrency: 2,
  },
);

worker.on('completed', (job) => {
  console.log(`[ingest-worker] terminé ${job.name} id=${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`[ingest-worker] échec ${job?.name} id=${job?.id}`, err);
});

console.log(
  `[ingest-worker] en écoute — queue=${INGEST_QUEUE_NAME} prefix=${bullmqPrefix()} pid=${process.pid}`,
);

async function shutdown() {
  console.log('[ingest-worker] arrêt…');
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
