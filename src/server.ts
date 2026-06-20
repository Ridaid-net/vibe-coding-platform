export const redis = new Redis(redisUrl, {
  // Cambiamos a null para permitir reintentos ilimitados por petición
  maxRetriesPerRequest: null, 
  
  // Permitimos que los comandos se encolen mientras Redis termina de iniciar
  enableOfflineQueue: true, 
  
  // Estrategia de reintento progresivo
  retryStrategy: (times) => {
    return Math.min(times * 1000, 5000); 
  },
  
  // Timeout de conexión inicial
  connectTimeout: 20000, 
});