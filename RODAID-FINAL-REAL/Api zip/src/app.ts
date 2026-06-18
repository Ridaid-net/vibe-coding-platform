// ─── RODAID · Express App ─────────────────────────────────
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import { env } from './config/env'
import { requestLogger } from './middleware/logger'
import { errorHandler } from './middleware/errorHandler'
import { globalRateLimit } from './middleware/rateLimiter'
import router from './routes'

const app = express()

// ── Seguridad HTTP headers ────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'"],
      styleSrc:      ["'self'","'unsafe-inline'"],
      connectSrc:    ["'self'"],
      frameSrc:      ["'none'"],
      objectSrc:     ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,  // permite iframes en docs
}))

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    // Sin origin → petición directa (curl, Postman, server-to-server)
    if (!origin) return cb(null, true)
    const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    if (allowed.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origen no permitido — ${origin}`))
  },
  credentials:     true,
  methods:         ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:  ['Content-Type','Authorization','X-Requested-With'],
  exposedHeaders:  ['X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset','Retry-After'],
}))

// ── Parsing y compresión ──────────────────────────────────
app.use(compression())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Trust proxy: Railway/Render/ALB agregan X-Forwarded-For
app.set('trust proxy', 1)

// ── Logging ───────────────────────────────────────────────
app.use(requestLogger)

// ── Rate limiting global por IP ───────────────────────────
// Los límites específicos por endpoint se aplican en routes/index.ts
app.use(globalRateLimit as express.RequestHandler)

// ── Rutas ─────────────────────────────────────────────────
app.use(`/api/${env.API_VERSION}`, router)

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } })
})

// ── Error handler global ──────────────────────────────────
app.use(errorHandler)

export default app
