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

function normalizeReturnValueForApi(rv: unknown): Record<string, unknown> | undefined {
  if (rv == null) return undefined;
  if (typeof rv === 'string') {
    try {
      const parsed = JSON.parse(rv) as unknown;
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof rv === 'object' && !Array.isArray(rv)) {
    return rv as Record<string, unknown>;
  }
  return undefined;
}

export async function getIngestJobState(jobId: string) {
  const queue = getIngestQueue();
  let job = await queue.getJob(jobId);
  if (!job) return null;
  let state = await job.getState();
  let rv = normalizeReturnValueForApi(job.returnvalue as unknown);

  /* Course rare : l’état « completed » apparaît avant returnvalue dans le hash Redis. */
  if (state === 'completed' && rv == null) {
    await new Promise((r) => setTimeout(r, 150));
    job = await queue.getJob(jobId);
    if (!job) return null;
    state = await job.getState();
    rv = normalizeReturnValueForApi(job.returnvalue as unknown);
  }

  return {
    id: job.id,
    name: job.name,
    state,
    returnvalue: rv,
    failedReason: job.failedReason,
    progress: job.progress,
    timestamp: job.timestamp,
    finishedOn: job.finishedOn,
  };
}

export type IngestQueueListItem = {
  id: string;
  name: string;
  state: 'waiting' | 'active' | 'delayed';
  partner?: string;
  timestamp: number;
};

/** Jobs visibles dans l’UI (file + worker), sans corps volumineux. */
export async function listIngestQueueJobs(): Promise<IngestQueueListItem[]> {
  const queue = getIngestQueue();
  const states = ['waiting', 'active', 'delayed'] as const;
  const chunks = await Promise.all(
    states.map((state) => queue.getJobs([state], 0, 40)),
  );
  const out: IngestQueueListItem[] = [];
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    for (const job of chunks[i]) {
      const id = job.id ?? '';
      const name = job.name ?? 'job';
      const raw = job.data as { partner?: string } | undefined;
      const partner =
        name === 'revenue-import' && raw && typeof raw.partner === 'string'
          ? raw.partner
          : undefined;
      out.push({
        id: String(id),
        name: String(name),
        state,
        partner,
        timestamp: typeof job.timestamp === 'number' ? job.timestamp : 0,
      });
    }
  }
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}
