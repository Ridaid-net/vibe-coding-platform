import Redis from 'ioredis';

let redisInstance: Redis | null = null;

export const getRedisClient = () => {
  if (redisInstance) return redisInstance;

  if (process.env.REDIS_URL) {
    redisInstance = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 10000,
      // Habilitar reconexión automática
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      }
    });

    // Manejo de eventos para debug
    redisInstance.on('error', (err) => console.error('Redis Client Error:', err));
    redisInstance.on('connect', () => console.log('✅ Redis conectado.'));
  } else {
    // Mock robusto
    redisInstance = {
      get: async () => null,
      set: async () => 'OK',
    } as any;
  }
  
  return redisInstance;
};