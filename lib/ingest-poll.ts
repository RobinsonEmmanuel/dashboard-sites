/**
 * Attente des jobs BullMQ (GA4, GSC, import revenus CSV) via GET /api/ingest/jobs/:id.
 */

import type { AffiliationPartner } from './models/revenue';
import { parseResponseJson } from './parse-response-json';

function notifyIngestQueueMaybeChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ingest-queue-maybe-changed'));
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll générique pour la file `dashboard-ingest`. */
export async function waitForQueueJob(
  jobId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const interval = opts?.intervalMs ?? 2000;
  const timeout = opts?.timeoutMs ?? 20 * 60 * 1000;
  const deadline = Date.now() + timeout;

  try {
    while (Date.now() < deadline) {
      const res = await fetch(`/api/ingest/jobs/${encodeURIComponent(jobId)}`);
      const data = (await parseResponseJson(res)) as {
        error?: string;
        state?: string;
        returnvalue?: Record<string, unknown>;
        failedReason?: string;
      };

      if (!res.ok && res.status !== 404) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (res.status === 404 || !data.state) {
        await sleep(interval);
        continue;
      }
      if (data.state === 'completed') {
        if (data.returnvalue && typeof data.returnvalue === 'object') {
          return data.returnvalue as Record<string, unknown>;
        }
        throw new Error('Job terminé sans résultat exploitable');
      }
      if (data.state === 'failed') {
        throw new Error(data.failedReason || 'Job échoué');
      }
      await sleep(interval);
    }

    throw new Error('Délai d’attente du job dépassé (timeout).');
  } finally {
    notifyIngestQueueMaybeChanged();
  }
}

export async function waitForIngestJob(
  jobId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  return waitForQueueJob(jobId, opts);
}

/** POST JSON sur /api/ingest/ga4 ou gsc ; si 202, attend le worker. */
export async function postIngest(
  endpoint: string,
  body: Record<string, unknown>,
  pollOpts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await parseResponseJson(res)) as { queued?: boolean; jobId?: string; error?: string };

  if (res.status === 202 && data.queued && data.jobId) {
    notifyIngestQueueMaybeChanged();
    return waitForQueueJob(String(data.jobId), { timeoutMs: pollOpts?.timeoutMs });
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data as Record<string, unknown>;
}

/**
 * POST FormData sur /api/revenue/import ; si 202, attend le worker (import CSV).
 */
export async function postRevenueImport(
  file: File,
  partnerOverride?: AffiliationPartner | '',
  pollOpts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const fd = new FormData();
  fd.append('file', file);
  if (partnerOverride) fd.append('partner', partnerOverride);

  const res = await fetch('/api/revenue/import', { method: 'POST', body: fd });
  const data = (await parseResponseJson(res)) as {
    queued?: boolean;
    jobId?: string;
    error?: string;
    detectedHeaders?: string[];
  };

  if (res.status === 202 && data.queued && data.jobId) {
    notifyIngestQueueMaybeChanged();
    const out = await waitForQueueJob(String(data.jobId), {
      timeoutMs: pollOpts?.timeoutMs ?? 45 * 60 * 1000,
    });
    if (out._status === 422) {
      throw new Error(String(out.error ?? 'Import refusé'));
    }
    return out;
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data as Record<string, unknown>;
}
