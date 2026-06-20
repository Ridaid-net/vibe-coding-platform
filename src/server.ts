// En src/server.ts
const redisUrl = process.env.REDIS_URL || 'redis://default:rodaid2026@rodaid-redis:6379';

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 10,
  retryStrategy(times) {
    return Math.min(times * 500, 2000); // Reintenta cada 500ms hasta 2 segundos
  }
});