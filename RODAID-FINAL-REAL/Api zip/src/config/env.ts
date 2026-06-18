// ─── RODAID · Configuración de entorno ───────────────────
import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'production', 'test']).default('development'),
  PORT:                   z.coerce.number().default(3001),
  API_VERSION:            z.string().default('v1'),
  DATABASE_URL:           z.string().min(1),
  REDIS_URL:              z.string().default('redis://127.0.0.1:6379'),
  JWT_SECRET:             z.string().min(32),
  JWT_ACCESS_EXPIRES:     z.string().default('15m'),
  JWT_REFRESH_EXPIRES:    z.string().default('7d'),

  // Sesiones Redis
  SESSION_TTL_DEFAULT:    z.string().default('7d'),     // sesión normal
  SESSION_TTL_EXTENDED:   z.string().default('30d'),    // "recordarme"
  SESSION_TTL_INSPECTOR:  z.string().default('12h'),    // inspectores — sesión corta
  SESSION_ACTIVITY_UPDATE: z.string().default('5m'),    // cada cuánto actualizar lastActivity
  SESSION_MAX_PER_USER:   z.coerce.number().default(10),// máximo de sesiones simultáneas
  ALLOWED_ORIGINS:        z.string().default('http://localhost:5173'),

  // BFA — opcional en dev
  BFA_RPC_URL:            z.string().optional(),
  BFA_WS_URL:              z.string().optional(),
  RODAID_MP_ACCESS_TOKEN:   z.string().optional(),  // MercadoPago Access Token
  ANALYTICS_IP_SALT:         z.string().default('rodaid-analytics-2026'),
  RODAID_TSA_URL:            z.string().url().optional(),   // TSA Gobierno Mendoza o pública
  RODAID_TSA_FALLBACK_URL:   z.string().url().optional(),   // TSA de respaldo
  RODAID_FONT_BS_REGULAR_B64:  z.string().optional(),  // Bianco Sport Regular base64
  RODAID_FONT_BS_SEMIBOLD_B64: z.string().optional(),  // Bianco Sport SemiBold base64
  RODAID_FONT_PATH:             z.string().optional(),  // directorio con archivos de fuente
  RODAID_BASE_URL:          z.string().url().default('https://rodaid.com.ar'),
  RODAID_FIRMA_CERT_PEM:  z.string().optional(),  // X.509 PEM del certificado de firma
  RODAID_FIRMA_KEY_PEM:   z.string().optional(),  // clave privada RSA PEM
  TESSERACT_DATA_PATH:     z.string().optional(),  // ruta local a tessdata
  PINATA_JWT:              z.string().optional(),  // WebSocket para eventos real-time
  BFA_TESTNET_RPC_URL:    z.string().optional(),  // URL nodo BFA testnet (chain 4338)
  BFA_CHAIN_ID:           z.coerce.number().optional(),
  BFA_WALLET_PRIVATE_KEY: z.string().optional(),
  RODAID_CUSTODIAL_WALLET: z.string().optional(), // wallet custodial para NFTs de usuarios sin wallet
  BFA_CONTRACT_ADDRESS:   z.string().optional(),

  // MxM — opcional en dev
  MXM_CLIENT_ID:          z.string().optional(),
  MXM_CLIENT_SECRET:      z.string().optional(),
  MXM_AUTH_URL:           z.string().url().optional(),
  MXM_TOKEN_URL:          z.string().url().optional(),
  MXM_REDIRECT_URI:       z.string().url().optional(),
  MXM_PAGOS_URL:          z.string().url().optional(),
  MXM_NOTIF_URL:          z.string().url().optional(),
  MXM_TRAMITES_URL:       z.string().url().optional(),

  // Storage S3
  STORAGE_BUCKET:         z.string().optional(),
  STORAGE_ACCESS_KEY:     z.string().optional(),
  STORAGE_SECRET_KEY:     z.string().optional(),

  // Servicios externos
  AWS_ACCESS_KEY_ID:   z.string().optional(),
  AWS_SECRET_ACCESS_KEY:z.string().optional(),
  AWS_REGION:          z.string().optional(),
  S3_BUCKET_FOTOS:     z.string().optional(),
  S3_CDN_URL:          z.string().optional(),
  S3_ENDPOINT:         z.string().optional(),
  RESEND_API_KEY:      z.string().optional(),
  SENDGRID_API_KEY:    z.string().optional(),
  EMAIL_FROM:             z.string().email().optional(),
  MP_ACCESS_TOKEN:        z.string().optional(),
  MP_WEBHOOK_SECRET:      z.string().optional(),
  MINSEG_KEY_ID:          z.string().optional(),
  MINSEG_WEBHOOK_SECRET:  z.string().optional(),
  MINSEG_CERT_PEM:        z.string().optional(),   // certificado cliente (PEM) para mTLS
  MINSEG_KEY_PEM:         z.string().optional(),   // clave privada (PEM) para mTLS
  MINSEG_CA_PEM:          z.string().optional(),   // CA de MinSeg para verificar servidor
  MINSEG_SANDBOX:         z.string().optional(),   // 'true' para usar sandbox
  MINSEG_API_URL:         z.string().url().optional(),
  MINSEG_API_KEY:         z.string().optional(),
  ANTHROPIC_API_KEY:      z.string().optional(),
  APNS_KEY_ID:         z.string().length(10).optional(),
  APNS_TEAM_ID:        z.string().length(10).optional(),
  APNS_PRIVATE_KEY:    z.string().optional(),
  APNS_BUNDLE_ID:      z.string().optional(),
  APNS_ENVIRONMENT:    z.enum(['sandbox','production']).optional(),
  FCM_PROJECT_ID:         z.string().optional(),
  FCM_PRIVATE_KEY:        z.string().optional(),
  FCM_SERVER_KEY:           z.string().optional(),
  FCM_CLIENT_EMAIL:       z.string().email().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Variables de entorno inválidas:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export const isDev  = env.NODE_ENV === 'development'
export const isProd = env.NODE_ENV === 'production'
