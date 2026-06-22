"use strict";
// ─── RODAID · QR Code Service ─────────────────────────────
// Genera códigos QR que apuntan al verificador público.
//
// URL destino: {RODAID_BASE_URL}/verificar/{serial}
//   → Ejemplo: https://rodaid.com.ar/verificar/SN-R84MK-TMIA-MZA
//   → El verificador muestra: estado BFA, propietario, historial
//
// Formatos de salida:
//   · Data URI PNG  — para embedding en HTML del Puppeteer PDF
//   · Buffer PNG    — para PDFKit (drawImage)
//   · SVG string    — para embedding vectorial en HTML/email
//
// Configuración del QR:
//   · Corrección de errores: M (15% — equilibrio tamaño/robustez)
//     Se puede leer aunque esté parcialmente cubierto por el logo
//   · Módulo oscuro: #0F1E35 (navy RODAID)
//   · Módulo claro:  #FFFFFF
//   · Margen (quiet zone): 1 módulo (mínimo recomendado por ISO 18004)
//   · Versión auto (mínima que permite el texto)
//
// La URL final tiene máx ~50 chars → versión 3-4 del QR → ≈200 módulos
// Con error correction M y módulos RODAID navy
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVerificadorURL = buildVerificadorURL;
exports.buildVerificadorHashURL = buildVerificadorHashURL;
exports.generarQR = generarQR;
exports.generarQRDataURI = generarQRDataURI;
exports.generarQRBuffer = generarQRBuffer;
exports.invalidarCacheQR = invalidarCacheQR;
const qrcode_1 = __importDefault(require("qrcode"));
const env_1 = require("../config/env");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// URL CANÓNICA DEL VERIFICADOR
// ══════════════════════════════════════════════════════════
/**
 * Construye la URL pública del verificador para un serial dado.
 * Normaliza el serial (mayúsculas, sin espacios) para URLs limpias.
 */
function buildVerificadorURL(serial) {
    const base = (env_1.env.RODAID_BASE_URL ?? 'https://rodaid.com.ar').replace(/\/$/, '');
    const serial_norm = serial.trim().toUpperCase().replace(/\s+/g, '-');
    return `${base}/verificar/${encodeURIComponent(serial_norm)}`;
}
/**
 * Construye URL de verificación por hash SHA-256 (alternativa más segura).
 * Útil cuando el serial puede cambiar o ser disputado.
 */
function buildVerificadorHashURL(hashSHA256) {
    const base = (env_1.env.RODAID_BASE_URL ?? 'https://rodaid.com.ar').replace(/\/$/, '');
    return `${base}/verificar/hash/${hashSHA256}`;
}
// ══════════════════════════════════════════════════════════
// GENERACIÓN DE QR
// ══════════════════════════════════════════════════════════
const DEFAULTS = {
    moduleSize: 6,
    margin: 1,
    colorDark: '#0F1E35', // navy RODAID
    colorLight: '#FFFFFF',
    errorCorrectionLevel: 'M',
};
/**
 * Genera un QR code completo en múltiples formatos.
 * Cacheado en memoria por URL (el mismo serial siempre produce el mismo QR).
 */
const _cache = new Map();
async function generarQR(serial, opts = {}) {
    const url = buildVerificadorURL(serial);
    const cacheKey = `${url}::${JSON.stringify(opts)}`;
    if (_cache.has(cacheKey))
        return _cache.get(cacheKey);
    const { moduleSize, margin, colorDark, colorLight, errorCorrectionLevel, } = { ...DEFAULTS, ...opts };
    const qrOpts = {
        errorCorrectionLevel,
        margin,
        color: { dark: colorDark, light: colorLight },
    };
    // Generar en paralelo PNG + SVG
    const [dataUriPNG, svg] = await Promise.all([
        qrcode_1.default.toDataURL(url, { ...qrOpts, scale: moduleSize }),
        qrcode_1.default.toString(url, { ...qrOpts, type: 'svg' }),
    ]);
    // Buffer PNG (extraer base64 del dataUri)
    const b64 = dataUriPNG.split(',')[1];
    const bufPNG = Buffer.from(b64, 'base64');
    // Tamaño aproximado: la URL ~50 chars → versión 5 → 37 módulos
    // Con margin=1: (37 + 2) módulos × moduleSize px
    const sizePx = Math.round((37 + 2 * margin) * moduleSize);
    const result = { url, dataUriPNG, bufferPNG: bufPNG, svg, sizePx };
    _cache.set(cacheKey, result);
    logger_1.log.qr.debug({ serial, url, sizePx, bytes: bufPNG.length }, '✓ QR generado');
    return result;
}
/** Generar QR solo como data URI PNG (más liviano para templates HTML) */
async function generarQRDataURI(serial, opts = {}) {
    const { dataUriPNG } = await generarQR(serial, opts);
    return dataUriPNG;
}
/** Generar QR como buffer PNG (para PDFKit) */
async function generarQRBuffer(serial, opts = {}) {
    const { bufferPNG } = await generarQR(serial, opts);
    return bufferPNG;
}
/** Invalidar caché para un serial (si el serial cambia) */
function invalidarCacheQR(serial) {
    if (serial) {
        const url = buildVerificadorURL(serial);
        for (const key of _cache.keys()) {
            if (key.startsWith(url))
                _cache.delete(key);
        }
    }
    else {
        _cache.clear();
    }
}
