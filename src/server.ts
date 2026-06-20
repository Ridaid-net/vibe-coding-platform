const redisUrl = process.env.REDIS_URL || 'redis://default:rodaid2026@rodaid-redis:6379';

const redis = new Redis(redisUrl, {
  // Ponemos los reintentos en 0 para que no lancen error fatal al arrancar
  maxRetriesPerRequest: 0, 
  retryStrategy(times) {
    // Si falla, esperamos un poco pero no lanzamos error fatal
    return 2000; 
  },
  // Esto evita que ioredis bloquee el proceso principal
  enableOfflineQueue: false 
});

// Agregamos un manejador de error manual para que no detenga el proceso
redis.on('error', (err) => {
  console.error('Redis no disponible, continuando en modo local:', err.message);
});