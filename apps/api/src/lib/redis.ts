import Redis from 'ioredis';

let client: Redis | null = null;

/**
 * Returns a singleton ioredis client connected to Upstash.
 * BullMQ requires maxRetriesPerRequest: null and enableReadyCheck: false for Upstash.
 */
export function getRedis(): Redis {
  if (!client) {
    const url = process.env.UPSTASH_REDIS_URL;
    if (!url) throw new Error('UPSTASH_REDIS_URL is not set');

    client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: url.startsWith('rediss://') ? {} : undefined,
    });
  }
  return client;
}
