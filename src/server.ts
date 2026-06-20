import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://default:rodaid2026@rodaid-redis:6379';

// Creamos la instancia única con configuración robusta
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 100, 2000)
});

redis.on('error', (err) => console.error('Redis error (ignorado):', err.message));