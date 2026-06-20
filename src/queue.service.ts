// En src/queue.service.ts
import { redis } from './server'; // Importa la instancia única

// Usa 'redis' directamente en lugar de 'new Redis(...)'
// Ejemplo: redis.get(...) o redis.set(...)