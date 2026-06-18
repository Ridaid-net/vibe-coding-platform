import Queue from 'bull';

// Obtenemos la URL de forma segura
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Inicializamos las colas
export const colaValidar = new Queue('validar', redisUrl);
export const colaFinalizar = new Queue('finalizar', redisUrl);

// Función para verificar la conexión antes de permitir que la app funcione
export const checkRedisConnection = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Usamos el cliente interno de una de las colas para verificar el estado
    const client = colaValidar.client;

    client.on('connect', () => {
      console.log('✅ Conectado a Redis exitosamente');
      resolve();
    });

    client.on('error', (err) => {
      console.error('❌ Error de conexión a Redis:', err);
      reject(err);
    });

    // Si ya está conectado, resolvemos inmediatamente
    if (client.status === 'ready') resolve();
  });
};