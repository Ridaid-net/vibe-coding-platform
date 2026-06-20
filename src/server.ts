import Redis from 'ioredis';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

/**
 * CONFIGURACIÓN DE REDIS
 * Si estamos en Docker, process.env.REDIS_URL inyectará 'redis://redis:6379'
 * Si estamos en desarrollo local, usará 'redis://localhost:6379'
 */
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
  // Estrategia de reintento para evitar bloqueos si Redis tarda en iniciar
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
});

// Eventos de conexión para monitoreo
redis.on('connect', () => {
  console.log(`✓ Redis conectado exitosamente a: ${redisUrl}`);
});

redis.on('ready', () => {
  console.log('✓ Redis está listo para recibir comandos');
});

redis.on('error', (err) => {
  console.error('--- DETALLE ERROR REDIS ---');
  console.error('Mensaje:', err.message);
  console.error('---------------------------');
});

// Nota: No es necesario llamar a redis.connect() explícitamente 
// ya que ioredis lo hace de forma perezosa al primer comando.