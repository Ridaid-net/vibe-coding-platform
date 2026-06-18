// ─── RODAID · Logging Estructurado (Pino) ────────────────
// • Desarrollo : pino-pretty coloreado, nivel debug
// • Producción : JSON puro en stdout + rotación diaria en /logs
// • Request ID : X-Request-ID propagado en cada log del request
// • Redacción  : campos sensibles never llegan al log
// • Métricas   : latencia, status, bytes, IP, userId por request

import pino, { Logger } from 'pino'
import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { env, isDev, isProd } from '../config/env'

// ══════════════════════════════════════════════════════════
// CAMPOS REDACTADOS — nunca aparecen en logs
// ══════════════════════════════════════════════════════════

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  // body fields
  'body.password',
  'body.passwordHash',
  'body.password_hash',
  'body.token',
  'body.refreshToken',
  'body.creditCard',
  'body.cvv',
  // top-level fields (en requests directos al logger)
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'refreshToken',
  'creditCard',
  'cvv',
  // nested data
  'data.password',
  'data.passwordHash',
  'data.refreshToken',
  'err.config.headers.authorization',
]

// ══════════════════════════════════════════════════════════
// SERIALIZADORES — formato estructurado de objetos complejos
// ══════════════════════════════════════════════════════════

const serializers: pino.LoggerOptions['serializers'] = {
  // Serializa errores con stack trace completo
  err: pino.stdSerializers.err,
  error: pino.stdSerializers.err,

  // Serializa req de Express — solo campos útiles
  req: (req: Request) => ({
    method:    req.method,
    url:       req.url,
    path:      req.path,
    params:    req.params,
    query:     req.query,
    ip:        req.ip ?? req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent'],
    requestId: req.headers['x-request-id'],
  }),

  // Serializa res — solo status y tamaño
  res: (res: Response) => ({
    statusCode:    res.statusCode,
    contentLength: res.getHeader('content-length'),
  }),
}

// ══════════════════════════════════════════════════════════
// LOGGER RAÍZ
// ══════════════════════════════════════════════════════════

function buildLogger(): Logger {
  const base: pino.LoggerOptions = {
    level: env.NODE_ENV === 'test' ? 'silent' : isDev ? 'debug' : 'info',
    serializers,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    base: {
      service: 'rodaid-api',
      version: process.env.npm_package_version ?? '0.1.0',
      env:     env.NODE_ENV,
      pid:     process.pid,
    },
    // Timestamp ISO 8601 legible por Datadog / Cloudwatch / Loki
    timestamp: pino.stdTimeFunctions.isoTime,
    // Serialización de errores en formato estándar
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        service: bindings['service'],
        version: bindings['version'],
        env:     bindings['env'],
      }),
    },
  }

  // ── Desarrollo: pretty-print coloreado en terminal ─────
  if (isDev) {
    return pino({
      ...base,
      transport: {
        target:  'pino-pretty',
        options: {
          colorize:      true,
          translateTime: 'HH:MM:ss.l',
          ignore:        'pid,hostname,service,version,env',
          messageFormat: '{msg}',
          singleLine:    false,
          levelFirst:    true,
        },
      },
    })
  }

  // ── Producción: JSON a stdout (Railway/Render/ECS lo recoge)
  // + rotación diaria a /logs si el directorio existe
  const targets: pino.TransportTargetOptions[] = [
    { target: 'pino/file', options: { destination: 1 }, level: 'info' },  // stdout
  ]

  // Añadir rotación a archivo solo si /logs es escribible
  try {
    const fs = require('fs')
    if (!fs.existsSync('/logs')) fs.mkdirSync('/logs', { recursive: true })
    targets.push({
      target:  'pino-roll',
      options: {
        file:         '/logs/rodaid-api.log',
        frequency:    'daily',
        size:         '50m',
        mkdir:        true,
        symlink:      true,   // /logs/rodaid-api.log → actual file
        dateFormat:   'YYYY-MM-DD',
        limit:        { count: 14 },  // conservar 14 días
      },
      level: 'debug',  // archivo guarda más detalle que stdout
    })
  } catch {
    // /logs no disponible — solo stdout
  }

  return pino(base, pino.transport({ targets }))
}

export const logger = buildLogger()

// ══════════════════════════════════════════════════════════
// CHILD LOGGERS — contexto por módulo/servicio
// Uso: const log = childLogger('marketplace')
//      log.info({ publicacionId }, 'Publicación creada')
// ══════════════════════════════════════════════════════════

export function childLogger(module: string, extra?: Record<string, unknown>): Logger {
  return logger.child({ module, ...extra })
}

// Loggers por módulo — pre-instanciados para performance
export const log = {
  auth:       childLogger('auth'),
  cit:        childLogger('cit'),
  marketplace: childLogger('marketplace'),
  seguridad:  childLogger('seguridad'),
  bfa:        childLogger('bfa'),
  ocr:        logger.child({ module: 'ocr' }),
  pdf:        logger.child({ module: 'pdf' }),
  firma:      logger.child({ module: 'firma' }),
  qr:         logger.child({ module: 'qr' }),
  font:       logger.child({ module: 'font' }),
  sello:      logger.child({ module: 'sello' }),
  verificador: logger.child({ module: 'verificador' }),
  estado:      logger.child({ module: 'estado' }),
  analytics:   logger.child({ module: 'analytics' }),
  public:     logger.child({ module: 'public' }),
  gps:        logger.child({ module: 'gps' }),
  minseg:     logger.child({ module: 'minseg' }),
  mxm:        childLogger('mxm'),
  queue:      childLogger('queue'),
  db:         childLogger('db'),
  rateLimiter: childLogger('rate-limiter'),
  escrow:      childLogger('escrow'),
  mp:          childLogger('mercadopago'),
  mensajeria:  childLogger('mensajeria'),
  storage:     childLogger('storage'),
}

// ══════════════════════════════════════════════════════════
// REQUEST LOGGER MIDDLEWARE
// Genera un requestId único, lo adjunta a cada log del request
// ══════════════════════════════════════════════════════════

// Extender Request para transportar el request logger
declare global {
  namespace Express {
    interface Request {
      requestId: string
      log:       Logger
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()

  // Generar/propagar X-Request-ID (trazabilidad entre servicios)
  const requestId = (req.headers['x-request-id'] as string)
    ?? `rod-${crypto.randomBytes(8).toString('hex')}`

  req.requestId = requestId
  res.setHeader('X-Request-ID', requestId)

  // Child logger con contexto del request — todos los logs del handler lo incluirán
  req.log = logger.child({
    requestId,
    method:    req.method,
    path:      req.path,
    ip:        req.ip ?? (req.headers['x-forwarded-for'] as string),
    userId:    (req as any).user?.sub,
    userAgent: req.headers['user-agent']?.slice(0, 80),
  })

  // Log de entrada — solo en debug (no spam en producción)
  req.log.debug({ query: req.query }, '→ Request recibido')

  res.on('finish', () => {
    const ms       = Date.now() - start
    const status   = res.statusCode
    const bytes    = parseInt(res.getHeader('content-length') as string || '0')

    const payload = {
      status,
      ms,
      bytes,
      requestId,
    }

    // Nivel según status code
    if (status >= 500) {
      req.log.error(payload, `← ${status} ${req.method} ${req.path} ${ms}ms`)
    } else if (status === 429) {
      req.log.warn({ ...payload, rateLimit: true }, `← 429 RATE_LIMIT ${req.path} ${ms}ms`)
    } else if (status >= 400) {
      req.log.warn(payload, `← ${status} ${req.method} ${req.path} ${ms}ms`)
    } else {
      // Rutas de health check: solo debug para no saturar logs
      if (req.path === `/api/${env.API_VERSION}/health`) {
        req.log.debug(payload, `← ${status} health ${ms}ms`)
      } else {
        req.log.info(payload, `← ${status} ${req.method} ${req.path} ${ms}ms`)
      }
    }
  })

  next()
}

// ══════════════════════════════════════════════════════════
// PROCESS-LEVEL LOGGERS — errores no capturados
// ══════════════════════════════════════════════════════════

export function setupProcessLoggers(): void {
  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err, type: 'uncaughtException' }, 'Excepción no capturada — proceso termina')
    process.exit(1)
  })

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason, type: 'unhandledRejection' }, 'Promise rechazada sin manejar — proceso termina')
    process.exit(1)
  })

  process.on('SIGTERM', () => logger.info({ signal: 'SIGTERM' }, 'Señal SIGTERM recibida'))
  process.on('SIGINT',  () => logger.info({ signal: 'SIGINT'  }, 'Señal SIGINT recibida'))

  logger.debug({ node: process.version, env: env.NODE_ENV }, 'Process loggers configurados')
}

// ══════════════════════════════════════════════════════════
// LOG PERFORMANCE — helper para medir bloques de código
// Uso: const end = startTimer('bfa.mint')
//      await mintNFT()
//      end({ tokenId })   → loga "bfa.mint completado 350ms"
// ══════════════════════════════════════════════════════════

export function startTimer(operation: string, ctx?: Record<string, unknown>) {
  const t0 = Date.now()
  return (extra?: Record<string, unknown>) => {
    const ms = Date.now() - t0
    logger.debug({ operation, ms, ...ctx, ...extra }, `${operation} completado`)
    return ms
  }
}
