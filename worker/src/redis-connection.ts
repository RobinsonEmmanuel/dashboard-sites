/**
 * Copie alignée sur `lib/jobs/redis-for-bullmq.ts`.
 * Reste dans le package worker pour éviter les bugs ESM Node 22 (exports nommés
 * depuis des .ts hors du dossier worker sur Railway).
 */
import Redis from 'ioredis';

function buildRedisOptions(url: string) {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: url.startsWith('rediss://') ? {} : undefined,
  };
}

export function createBullmqConnection(): Redis {
  const url = process.env.BULLMQ_REDIS_URL?.trim();
  if (!url) {
    throw new Error('Variable BULLMQ_REDIS_URL manquante (URL Redis Upstash « Redis »)');
  }
  return new Redis(url, buildRedisOptions(url));
}

export function bullmqPrefix(): string {
  return process.env.BULLMQ_PREFIX?.trim() || '{dashboard-sites}';
}
