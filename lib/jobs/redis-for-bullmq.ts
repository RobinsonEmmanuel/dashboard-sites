import IORedis from 'ioredis';

function buildRedisOptions(url: string) {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: url.startsWith('rediss://') ? {} : undefined,
  };
}

/**
 * Nouvelle connexion (à utiliser côté worker BullMQ — ne pas partager l’instance avec un Worker).
 */
export function createBullmqConnection(): IORedis {
  const url = process.env.BULLMQ_REDIS_URL?.trim();
  if (!url) {
    throw new Error('Variable BULLMQ_REDIS_URL manquante (URL Redis Upstash « Redis »)');
  }
  return new IORedis(url, buildRedisOptions(url));
}

let shared: IORedis | null = null;

/**
 * Connexion Redis pour BullMQ (Upstash ou tout Redis TLS `rediss://`).
 * Instance partagée côté Next.js pour la production de jobs.
 */
export function getBullmqConnection(): IORedis {
  if (shared) return shared;
  shared = createBullmqConnection();
  return shared;
}

export function bullmqPrefix(): string {
  return process.env.BULLMQ_PREFIX?.trim() || '{dashboard-sites}';
}
