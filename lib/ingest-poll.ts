/**
 * Utilitaires client pour l’ingestion GA4/GSC : si l’API répond 202 (file BullMQ),
 * attend la fin du job via GET /api/ingest/jobs/:id.
 */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForIngestJob(
  jobId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const interval = opts?.intervalMs ?? 2000;
  const timeout = opts?.timeoutMs ?? 20 * 60 * 1000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const res = await fetch(`/api/ingest/jobs/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as {
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
      throw new Error(data.failedReason || 'Job d’ingestion échoué');
    }
    await sleep(interval);
  }

  throw new Error('Délai d’attente du job d’ingestion dépassé (timeout).');
}

/** POST sur /api/ingest/ga4 ou gsc ; si 202, attend le résultat du worker. */
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
  const data = (await res.json()) as { queued?: boolean; jobId?: string; error?: string };

  if (res.status === 202 && data.queued && data.jobId) {
    return waitForIngestJob(String(data.jobId), { timeoutMs: pollOpts?.timeoutMs });
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data as Record<string, unknown>;
}
