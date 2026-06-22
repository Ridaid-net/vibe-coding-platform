"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ─── RODAID · Express App ─────────────────────────────────
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const env_1 = require("./config/env");
const logger_1 = require("./middleware/logger");
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimiter_1 = require("./middleware/rateLimiter");
const routes_1 = __importDefault(require("./routes"));
const app = (0, express_1.default)();
// ── Seguridad HTTP headers ────────────────────────────────
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false, // permite iframes en docs
}));
// ── CORS ──────────────────────────────────────────────────
app.use((0, cors_1.default)({
    origin: (origin, cb) => {
        // Sin origin → petición directa (curl, Postman, server-to-server)
        if (!origin)
            return cb(null, true);
        const allowed = env_1.env.ALLOWED_ORIGINS.split(',').map(s => s.trim());
        if (allowed.includes(origin))
            return cb(null, true);
        cb(new Error(`CORS: origen no permitido — ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
}));
// ── Parsing y compresión ──────────────────────────────────
app.use((0, compression_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// ── Trust proxy: Railway/Render/ALB agregan X-Forwarded-For
app.set('trust proxy', 1);
// ── Logging ───────────────────────────────────────────────
app.use(logger_1.requestLogger);
// ── Rate limiting global por IP ───────────────────────────
// Los límites específicos por endpoint se aplican en routes/index.ts
app.use(rateLimiter_1.globalRateLimit);
// ── Rutas ─────────────────────────────────────────────────
app.use(`/api/${env_1.env.API_VERSION}`, routes_1.default);
// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
});
// ── Error handler global ──────────────────────────────────
app.use(errorHandler_1.errorHandler);
exports.default = app;
