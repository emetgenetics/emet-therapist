import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

export default redis;

// Session cache helpers
export async function cacheSession(sessionId: string, data: Record<string, unknown>, ttlSeconds = 7200): Promise<void> {
  await redis.setex(`session:${sessionId}`, ttlSeconds, JSON.stringify(data));
}

export async function getCachedSession(sessionId: string): Promise<Record<string, unknown> | null> {
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
}

// Rate limiting
export async function checkRateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }
  return current <= maxRequests;
}
