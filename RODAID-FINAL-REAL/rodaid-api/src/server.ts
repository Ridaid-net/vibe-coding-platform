import app from './app'
import { env } from './config/env'
import { pool } from './config/database'
import { logger, setupProcessLoggers } from './middleware/logger'
import { initQueue } from './services/queue.service'
import { initRateLimiters, closeRateLimiters } from './middleware/rateLimiter'

async function main() {
  setupProcessLoggers()
  // 1. PostgreSQL
  try {
    await pool.query('SELECT 1')
    logger.info('✓ PostgreSQL conectado')
  } catch (err) {
    logger.error({ err }, '✗ PostgreSQL no disponible'); process.exit(1)
  }

  // 2. Rate limiters (Redis sliding window)
  await initRateLimiters()

  // 3. Bull/Redis queue — requerido para flujo 72 hs
  await initQueue()

  // 3. HTTP server
  const server = app.listen(env.PORT, () => {
    logger.info(`RODAID API v0.1.0 · :${env.PORT} · ${env.NODE_ENV}`)
    logger.info(`Health: http://localhost:${env.PORT}/api/${env.API_VERSION}/health`)
  })

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'Apagando...')
    server.close(async () => {
      await closeRateLimiters()
      await // stopQueue()
      await pool.end()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 15_000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

main()
