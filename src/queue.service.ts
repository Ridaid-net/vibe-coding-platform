import Redis from 'ioredis';

// Usamos la variable de entorno o la conexión local por defecto
const redisUrl = process.env.REDIS_URL || 'redis://default:rodaid2026@rodaid-redis:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 100, 2000)
});

redis.on('error', (err) => console.error('Redis error (ignorado):', err.message));
redis.on('connect', () => console.log('Redis conectado exitosamente'));