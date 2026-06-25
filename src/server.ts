import app from './app'
import { env } from './config/env'
import { pool } from './config/database'
import { logger, setupProcessLoggers } from './middleware/logger'
import { initQueue } from './services/queue.service'
import { initRateLimiters, closeRateLimiters } from './middleware/rateLimiter'

async function main() {
  setupProcessLoggers()

  console.log('=== DEBUG ENV REDIS ===')
  console.log('REDIS_URL:', JSON.stringify(process.env.REDIS_URL))
  console.log('REDISHOST:', JSON.stringify(process.env.REDISHOST))
  console.log('REDISPORT:', JSON.stringify(process.env.REDISPORT))
  console.log('REDISUSER:', JSON.stringify(process.env.REDISUSER))
  console.log('Todas las keys que contienen REDIS:', Object.keys(process.env).filter(k => k.toUpperCase().includes('REDIS')))
  console.log('=== FIN DEBUG ===')

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection capturada - proceso continua')
  })
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException capturada - proceso continua')
  })

  try {
    await pool.query('SELECT 1')
    logger.info('PostgreSQL conectado')
  } catch (err) {
    logger.error({ err }, 'PostgreSQL no disponible')
    process.exit(1)
  }

  try {
    await initRateLimiters()
  } catch (err) {
    logger.error({ err }, 'initRateLimiters fallo - continuando sin Redis')
  }

  try {
    await initQueue()
  } catch (err) {
    logger.error({ err }, 'initQueue fallo - continuando sin colas')
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`RODAID API v0.1.0 - puerto ${env.PORT} - ${env.NODE_ENV}`)
    logger.info(`Health: http://localhost:${env.PORT}/api/${env.API_VERSION}/health`)
  })

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'Apagando...')
    server.close(async () => {
      await closeRateLimiters().catch(() => {})
      await pool.end().catch(() => {})
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 15000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Error fatal en main():', err)
  process.exit(1)
})
