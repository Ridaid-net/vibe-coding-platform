import Bull, { Queue, JobOptions } from 'bull';
import { log } from '../middleware/logger';

// 1. Función para obtener configuración limpia de Redis
const getRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    // Si viene de Railway, usamos la URL directamente.
    // Si la URL es una referencia dinámica, aseguramos que sea string.
    return String(redisUrl);
  }

  // Fallback para desarrollo local
  return {
    host: '127.0.0.1',
    port: 6379,
  };
};

const redisConfig = getRedisConnection();

const defaultOptions: JobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

// 2. Instancias de Colas tipadas
export const qValidar: Queue   = new Bull('rodaid:cit:validar',   { redis: redisConfig, defaultJobOptions: defaultOptions });
export const qFinalizar: Queue = new Bull('rodaid:cit:finalizar', { redis: redisConfig, defaultJobOptions: defaultOptions });
export const qNotif: Queue     = new Bull('rodaid:notif',         { redis: redisConfig, defaultJobOptions: defaultOptions });
export const qExpire: Queue    = new Bull('rodaid:cit:expirar',   { redis: redisConfig, defaultJobOptions: defaultOptions });

// 3. Inicialización (Workers)
export async function initQueue(): Promise<void> {
  try {
    // Log para confirmar que intentamos conectar
    log.queue.info(`Configurando colas con Redis en: ${process.env.REDIS_URL || 'localhost:6379'}`);
    
    // Aquí puedes registrar los procesadores (procesar trabajos)
    // qValidar.process(async (job) => { ... });
    
    log.queue.info('✓ Pipeline de validación CIT inicializado correctamente.');
  } catch (err) {
    log.queue.error({ err }, '✗ Error crítico al inicializar colas');
    throw err; // Re-lanzar para que Railway pueda reiniciar el proceso
  }
}

// 4. API de encolado con manejo de errores
export async function encolarValidacion(citId: string, venceEn: Date): Promise<string | undefined> {
  try {
    const delayMs = Math.max(0, venceEn.getTime() - Date.now());
    const job = await qValidar.add({ citId }, { delay: delayMs, jobId: `validar:${citId}` });
    return String(job.id);
  } catch (error) {
    log.queue.error({ error }, `Error al encolar validación para CIT ${citId}`);
    return undefined;
  }
}

export async function encolarFinalizar(citId: string, propietarioWallet?: string): Promise<string | undefined> {
  try {
    const job = await qFinalizar.add({ citId, propietarioWallet }, { jobId: `finalizar:${citId}` });
    return String(job.id);
  } catch (error) {
    log.queue.error({ error }, `Error al encolar finalizar para CIT ${citId}`);
    return undefined;
  }
}
