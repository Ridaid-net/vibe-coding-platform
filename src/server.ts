export const redis = new Redis(redisUrl, {
  // FUERZA LA DESACTIVACIÓN DEL LÍMITE
  maxRetriesPerRequest: null,
  
  // Aumentamos los tiempos para dar margen a Railway
  retryStrategy: (times) => {
    const delay = Math.min(times * 1000, 3000);
    return delay;
  },
  
  // Desactivamos la desconexión rápida
  connectTimeout: 60000,
  
  // Esto evita que ioredis intente reconectar agresivamente y crashee
  enableAutoPipelining: true,
  autoResubscribe: false,
});

// AÑADE ESTO: Manejo global de errores para que NO cierren el proceso
redis.on('error', (err) => {
  console.error('Redis (Capturado):', err.message);
});