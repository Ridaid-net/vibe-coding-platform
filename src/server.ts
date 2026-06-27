import app from './app'
import { env } from './config/env'
import { pool } from './config/database'
import { logger, setupProcessLoggers } from './middleware/logger'
import { initQueue } from './services/queue.service'
import { initRateLimiters, closeRateLimiters } from './middleware/rateLimiter'

process.on('unhandledRejection', (reason: any) => {
  console.error('unhandledRejection (raw):', reason)
  console.error('unhandledRejection stack:', reason?.stack)
  try {
    logger.error({ err: reason?.message ?? String(reason), stack: reason?.stack }, 'unhandledRejection capturada - proceso continua')
  } catch {}
})
process.on('uncaughtException', (err: any) => {
  console.error('uncaughtException (raw):', err)
  console.error('uncaughtException stack:', err?.stack)
  try {
    logger.error({ err: err?.message ?? String(err), stack: err?.stack }, 'uncaughtException capturada - proceso continua')
  } catch {}
})

async function main() {
  setupProcessLoggers()


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
    logger.error({ err }, 'initRateLimiters fallo - continuando sin Redis (modo memoria)')
  }

  try {
    await initQueue()
  } catch (err) {
    logger.error({ err }, 'initQueue fallo - continuando sin sistema de colas')
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
