import { Queue } from 'bull';

// Configuración segura de Redis
const getRedisConfig = () => {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('⚠️ REDIS_URL no está definido. Las colas no funcionarán.');
    return { host: '127.0.0.1', port: 6379 }; // Respaldo local
  }
  return url;
};

// Instancia de colas
export const colaValidar = new Queue('validar', getRedisConfig());
export const colaFinalizar = new Queue('finalizar', getRedisConfig());

console.log('✅ Servicios de cola inicializados.');
