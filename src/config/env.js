"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProd = exports.isDev = exports.env = void 0;
// ─── RODAID · Configuración de entorno ───────────────────
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.coerce.number().default(3001),
    API_VERSION: zod_1.z.string().default('v1'),
    DATABASE_URL: zod_1.z.string().min(1),
    REDIS_URL: zod_1.z.string().default('redis://127.0.0.1:6379'),
    JWT_SECRET: zod_1.z.string().min(32),
    JWT_ACCESS_EXPIRES: zod_1.z.string().default('15m'),
    JWT_REFRESH_EXPIRES: zod_1.z.string().default('7d'),
    // Sesiones Redis
    SESSION_TTL_DEFAULT: zod_1.z.string().default('7d'), // sesión normal
    SESSION_TTL_EXTENDED: zod_1.z.string().default('30d'), // "recordarme"
    SESSION_TTL_INSPECTOR: zod_1.z.string().default('12h'), // inspectores — sesión corta
    SESSION_ACTIVITY_UPDATE: zod_1.z.string().default('5m'), // cada cuánto actualizar lastActivity
    SESSION_MAX_PER_USER: zod_1.z.coerce.number().default(10), // máximo de sesiones simultáneas
    ALLOWED_ORIGINS: zod_1.z.string().default('http://localhost:5173'),
    // BFA — opcional en dev
    BFA_RPC_URL: zod_1.z.string().optional(),
    BFA_WS_URL: zod_1.z.string().optional(),
    RODAID_MP_ACCESS_TOKEN: zod_1.z.string().optional(), // MercadoPago Access Token
    ANALYTICS_IP_SALT: zod_1.z.string().default('rodaid-analytics-2026'),
    RODAID_TSA_URL: zod_1.z.string().url().optional(), // TSA Gobierno Mendoza o pública
    RODAID_TSA_FALLBACK_URL: zod_1.z.string().url().optional(), // TSA de respaldo
    RODAID_FONT_BS_REGULAR_B64: zod_1.z.string().optional(), // Bianco Sport Regular base64
    RODAID_FONT_BS_SEMIBOLD_B64: zod_1.z.string().optional(), // Bianco Sport SemiBold base64
    RODAID_FONT_PATH: zod_1.z.string().optional(), // directorio con archivos de fuente
    RODAID_BASE_URL: zod_1.z.string().url().default('https://rodaid.com.ar'),
    RODAID_FIRMA_CERT_PEM: zod_1.z.string().optional(), // X.509 PEM del certificado de firma
    RODAID_FIRMA_KEY_PEM: zod_1.z.string().optional(), // clave privada RSA PEM
    TESSERACT_DATA_PATH: zod_1.z.string().optional(), // ruta local a tessdata
    PINATA_JWT: zod_1.z.string().optional(), // WebSocket para eventos real-time
    BFA_TESTNET_RPC_URL: zod_1.z.string().optional(), // URL nodo BFA testnet (chain 4338)
    BFA_CHAIN_ID: zod_1.z.coerce.number().optional(),
    BFA_WALLET_PRIVATE_KEY: zod_1.z.string().optional(),
    RODAID_CUSTODIAL_WALLET: zod_1.z.string().optional(), // wallet custodial para NFTs de usuarios sin wallet
    BFA_CONTRACT_ADDRESS: zod_1.z.string().optional(),
    // MxM — opcional en dev
    MXM_CLIENT_ID: zod_1.z.string().optional(),
    MXM_CLIENT_SECRET: zod_1.z.string().optional(),
    MXM_AUTH_URL: zod_1.z.string().url().optional(),
    MXM_TOKEN_URL: zod_1.z.string().url().optional(),
    MXM_REDIRECT_URI: zod_1.z.string().url().optional(),
    MXM_PAGOS_URL: zod_1.z.string().url().optional(),
    MXM_NOTIF_URL: zod_1.z.string().url().optional(),
    MXM_TRAMITES_URL: zod_1.z.string().url().optional(),
    // Storage S3
    STORAGE_BUCKET: zod_1.z.string().optional(),
    STORAGE_ACCESS_KEY: zod_1.z.string().optional(),
    STORAGE_SECRET_KEY: zod_1.z.string().optional(),
    // Servicios externos
    AWS_ACCESS_KEY_ID: zod_1.z.string().optional(),
    AWS_SECRET_ACCESS_KEY: zod_1.z.string().optional(),
    AWS_REGION: zod_1.z.string().optional(),
    S3_BUCKET_FOTOS: zod_1.z.string().optional(),
    S3_CDN_URL: zod_1.z.string().optional(),
    S3_ENDPOINT: zod_1.z.string().optional(),
    RESEND_API_KEY: zod_1.z.string().optional(),
    SENDGRID_API_KEY: zod_1.z.string().optional(),
    EMAIL_FROM: zod_1.z.string().email().optional(),
    MP_ACCESS_TOKEN: zod_1.z.string().optional(),
    MP_WEBHOOK_SECRET: zod_1.z.string().optional(),
    MINSEG_KEY_ID: zod_1.z.string().optional(),
    MINSEG_WEBHOOK_SECRET: zod_1.z.string().optional(),
    MINSEG_API_URL: zod_1.z.string().url().optional(),
    MINSEG_API_KEY: zod_1.z.string().optional(),
    ANTHROPIC_API_KEY: zod_1.z.string().optional(),
    APNS_KEY_ID: zod_1.z.string().length(10).optional(),
    APNS_TEAM_ID: zod_1.z.string().length(10).optional(),
    APNS_PRIVATE_KEY: zod_1.z.string().optional(),
    APNS_BUNDLE_ID: zod_1.z.string().optional(),
    APNS_ENVIRONMENT: zod_1.z.enum(['sandbox', 'production']).optional(),
    FCM_PROJECT_ID: zod_1.z.string().optional(),
    FCM_PRIVATE_KEY: zod_1.z.string().optional(),
    FCM_SERVER_KEY: zod_1.z.string().optional(),
    FCM_CLIENT_EMAIL: zod_1.z.string().email().optional(),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('❌  Variables de entorno inválidas:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}
exports.env = parsed.data;
exports.isDev = exports.env.NODE_ENV === 'development';
exports.isProd = exports.env.NODE_ENV === 'production';
