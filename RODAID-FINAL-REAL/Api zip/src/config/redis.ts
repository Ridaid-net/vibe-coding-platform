// ─── RODAID · Redis Connection ────────────────────────────
import Redis from 'ioredis'
import { env } from './env'
import { logger } from '../middleware/logger'

let redisInstance: Redis | null = null

export function getRedis(): Redis {
  if (redisInstance) return redisInstance

  redisInstance = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,  // requerido por BullMQ
    enableReadyCheck:     false, // idem
    lazyConnect:          false,
    retryStrategy: (times) => {
      const delay = Math.min(times * 500, 5000)  // back-off hasta 5 s
      logger.warn({ times, delay }, 'Redis: reintentando conexión')
      return delay
    },
  })

  redisInstance.on('connect', () => logger.info('✓ Redis conectado'))
  redisInstance.on('error',   (err: Error) => logger.error({ err }, 'Redis error'))
  redisInstance.on('close',   () => logger.warn('Redis: conexión cerrada'))

  return redisInstance
}

export async function pingRedis(): Promise<boolean> {
  try {
    const reply = await getRedis().ping()
    return reply === 'PONG'
  } catch {
    return false
  }
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit()
    redisInstance = null
    logger.info('Redis: conexión cerrada correctamente')
  }
}
