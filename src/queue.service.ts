import Bull from 'bull';

// Solo intentamos inicializar Bull si tenemos una URL de Redis válida
const redisUrl = process.env.REDIS_URL || null;
let queue: any = null;

if (redisUrl) {
  try {
    queue = new Bull('mi-cola', redisUrl);
    console.log('✓ Bull Queue conectada a Redis');
  } catch (err) {
    console.error('⚠ Fallo al conectar Bull a Redis:', err);
  }
} else {
  console.log('ℹ Redis no configurado. Iniciando sin sistema de colas.');
}

export { queue };