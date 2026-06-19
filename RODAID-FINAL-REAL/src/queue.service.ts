import Redis from 'ioredis';

let redisInstance: any = null;

export const getRedisClient = () => {
  // Si ya tenemos la instancia, la devolvemos
  if (redisInstance) return redisInstance;

  // Si no, la creamos SOLO cuando se llama a esta función
  if (process.env.REDIS_URL) {
    try {
      redisInstance = new Redis(process.env.REDIS_URL, {
        lazyConnect: true, // Esto es vital: NO conecta hasta que sea necesario
        connectTimeout: 10000
      });
      console.log("✅ Instancia de Redis creada (Lazy).");
    } catch (error) {
      console.error("⚠ Error al instanciar Redis.");
    }
  }
  
  // Si falla o no hay URL, devolvemos un mock básico para no romper la app
  if (!redisInstance) {
    redisInstance = {
      get: async () => null,
      set: async () => 'OK',
      // ... otros métodos necesarios
    };
  }
  
  return redisInstance;
};