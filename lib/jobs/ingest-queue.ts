import { Queue } from 'bullmq';
import { bullmqPrefix, getBullmqConnection } from './redis-for-bullmq';
import { INGEST_QUEUE_NAME } from './ingest-queue-name';
import type { Ga4IngestInput } from './run-ga4-ingest';
import type { GscIngestInput } from './run-gsc-ingest';
import type { RevenueImportInput } from './run-revenue-import';

export { INGEST_QUEUE_NAME };

let ingestQueue: Queue | null = null;

export function ingestQueueEnabled(): boolean {
  return Boolean(process.env.BULLMQ_REDIS_URL?.trim());
}

export function getIngestQueue(): Queue {
  if (!ingestQueue) {
    ingestQueue = new Queue(INGEST_QUEUE_NAME, {
      connection: getBullmqConnection(),
      prefix: bullmqPrefix(),
      defaultJobOptions: {
        removeOnComplete: 250,
        removeOnFail: 120,
      },
    });
  }
  return ingestQueue;
}

export async function enqueueGa4Ingest(data: Ga4IngestInput) {
  const queue = getIngestQueue();
  return queue.add('ga4', data, { jobId: `ga4-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` });
}

export async function enqueueGscIngest(data: GscIngestInput) {
  const queue = getIngestQueue();
  return queue.add('gsc', data, { jobId: `gsc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` });
}

/** Limite prudente pour le corps du job (Redis / Upstash). */
export const REVENUE_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

export async function enqueueRevenueImport(data: RevenueImportInput) {
  const queue = getIngestQueue();
  return queue.add('revenue-import', data, {
    jobId: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  });
}

export async function getIngestJobState(jobId: string) {
  const queue = getIngestQueue();
  const job = await queue.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  return {
    id: job.id,
    name: job.name,
    state,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    progress: job.progress,
    timestamp: job.timestamp,
    finishedOn: job.finishedOn,
  };
}
