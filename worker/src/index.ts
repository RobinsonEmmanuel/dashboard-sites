/**
 * Worker Railway : consomme la file BullMQ `dashboard-ingest` (GA4 / GSC).
 *
 * Variables d’environnement (mêmes que Vercel pour l’ingestion) :
 *   BULLMQ_REDIS_URL   — URL Redis Upstash (onglet « Redis », format rediss://)
 *   BULLMQ_PREFIX      — optionnel, défaut {dashboard-sites} (hash tag cluster Upstash)
 *   MONGODB_URI, MONGODB_DB_NAME
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
 */

import { Worker } from 'bullmq';
import { createBullmqConnection, bullmqPrefix } from '../../lib/jobs/redis-for-bullmq';
import { runGa4Ingest } from '../../lib/jobs/run-ga4-ingest';
import { runGscIngest } from '../../lib/jobs/run-gsc-ingest';
import { INGEST_QUEUE_NAME } from '../../lib/jobs/ingest-queue-name';

const connection = createBullmqConnection();

const worker = new Worker(
  INGEST_QUEUE_NAME,
  async (job) => {
    if (job.name === 'ga4') return await runGa4Ingest(job.data ?? {});
    if (job.name === 'gsc') return await runGscIngest(job.data ?? {});
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
