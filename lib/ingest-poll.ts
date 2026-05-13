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

function coerceCompletedReturnValue(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown;
      if (v != null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

/** Poll générique pour la file `dashboard-ingest`. */
export async function waitForQueueJob(
  jobId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const interval = opts?.intervalMs ?? 2000;
  const timeout = opts?.timeoutMs ?? 20 * 60 * 1000;
  const deadline = Date.now() + timeout;
  /** completed vu sans returnvalue (course Redis / BullMQ) */
  let completedMissingReturn = 0;
  const maxCompletedMissingReturn = 45;

  try {
    while (Date.now() < deadline) {
      const res = await fetch(`/api/ingest/jobs/${encodeURIComponent(jobId)}`);
      const data = (await parseResponseJson(res)) as {
        error?: string;
        state?: string;
        returnvalue?: unknown;
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
        const out = coerceCompletedReturnValue(data.returnvalue);
        if (out) {
          return out;
        }
        completedMissingReturn++;
        if (completedMissingReturn > maxCompletedMissingReturn) {
          throw new Error(
            'Le job s’est terminé mais le résultat n’est pas revenu depuis Redis. Vérifiez BULLMQ_PREFIX (identique Vercel / worker), les logs du worker, ou réessayez.',
          );
        }
        await sleep(Math.min(400, interval));
        continue;
      }
      completedMissingReturn = 0;
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
