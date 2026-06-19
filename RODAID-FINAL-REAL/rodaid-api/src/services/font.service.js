"use strict";
// ─── RODAID · Font Service — Bianco Sport Embedding ──────
// Gestiona la tipografía del certificado CIT.
//
// Fuente principal: Bianco Sport (si está disponible)
//   · Se provee vía variable de entorno RODAID_FONT_BIANCO_SPORT_B64
//     o como archivo en RODAID_FONT_BIANCO_SPORT_PATH
//   · Pesos usados: Regular (400), SemiBold (600)
//
// Fallback: Rajdhani (npm @fontsource/rajdhani · latin subset WOFF2)
//   · Fuente geométrica condensada, deportiva — same DNA que Bianco Sport
//   · Pesos: 300, 400, 500, 600 — todos embebidos (~50KB total WOFF2)
//   · Cero dependencias externas en producción
//
// Jerarquía tipográfica del CIT:
//   Display   (28pt 600) → Logo "RODAID"
//   H1        (18pt 600) → Número de certificado: "RCIT-2026-00049"
//   H2        (11pt 600) → Título del certificado
//   SectionH  ( 7pt 600) → Encabezados de sección (ALL CAPS)
//   FieldVal  (10pt 500) → Valores de campos
//   FieldLbl  ( 7pt 400) → Labels de campos
//   HashMono  ( 7pt 400) → SHA-256 (Courier monospace)
//   Caption   ( 6.5pt 400) → Texto legal, pie de página
//
// Uso en Puppeteer (HTML):
//   const css = await getFontFaceCSS()
//   → @font-face { font-family: 'BiancoSport'; ... }
//
// Uso en PDFKit:
//   const { regular, semibold } = await getFontBuffers()
//   doc.registerFont('BiancoSport', regular)
//   doc.registerFont('BiancoSport-SemiBold', semibold)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FONT_WEIGHTS = exports.FONT_FAMILY = void 0;
exports.invalidarCacheFuentes = invalidarCacheFuentes;
exports.getFontBuffers = getFontBuffers;
exports.getFontFaceCSS = getFontFaceCSS;
exports.getFontInfo = getFontInfo;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const env_1 = require("../config/env");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
/** Nombre lógico de la fuente que se usa en CSS y PDFKit */
exports.FONT_FAMILY = 'BiancoSport';
/** Pesos disponibles */
exports.FONT_WEIGHTS = {
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
};
// Rutas a los archivos WOFF2 de Rajdhani (fallback)
// @fontsource/rajdhani incluye subconjunto latin (sólo caracteres latinos)
const RAJDHANI_BASE = path_1.default.resolve(process.cwd(), 'node_modules/@fontsource/rajdhani/files');
function rajdhaniFile(weight, ext) {
    return path_1.default.join(RAJDHANI_BASE, `rajdhani-latin-${weight}-normal.${ext}`);
}
let _fontSetCache = null;
// ══════════════════════════════════════════════════════════
// CARGA DE FUENTES
// ══════════════════════════════════════════════════════════
async function cargarFuentes() {
    if (_fontSetCache)
        return _fontSetCache;
    // 1. Bianco Sport real desde variable de entorno (base64 separadas por pipe)
    //    RODAID_FONT_BS_REGULAR_B64 y RODAID_FONT_BS_SEMIBOLD_B64
    if (env_1.env.RODAID_FONT_BS_REGULAR_B64 && env_1.env.RODAID_FONT_BS_SEMIBOLD_B64) {
        try {
            const regular = Buffer.from(env_1.env.RODAID_FONT_BS_REGULAR_B64, 'base64');
            const semibold = Buffer.from(env_1.env.RODAID_FONT_BS_SEMIBOLD_B64, 'base64');
            if (regular.length > 1000 && semibold.length > 1000) {
                logger_1.log.font.info({ source: 'env', bytes: regular.length + semibold.length }, '🔤 Bianco Sport cargada desde env');
                _fontSetCache = { regular, semibold, source: 'bianco-sport' };
                return _fontSetCache;
            }
        }
        catch (err) {
            logger_1.log.font.warn({ err: err.message }, 'Error cargando Bianco Sport desde env');
        }
    }
    // 2. Bianco Sport desde directorio configurado (ej: ./fonts/BiancoSport-Regular.ttf)
    const fontDir = env_1.env.RODAID_FONT_PATH;
    if (fontDir) {
        const candidates = [
            ['BiancoSport-Regular.ttf', 'BiancoSport-SemiBold.ttf'],
            ['BiancoSport-Regular.otf', 'BiancoSport-SemiBold.otf'],
            ['BiancoSport-Regular.woff2', 'BiancoSport-SemiBold.woff2'],
            ['Bianco-Sport-Regular.ttf', 'Bianco-Sport-Bold.ttf'],
        ];
        for (const [reg, bold] of candidates) {
            const regPath = path_1.default.join(fontDir, reg);
            const boldPath = path_1.default.join(fontDir, bold);
            if (fs_1.default.existsSync(regPath) && fs_1.default.existsSync(boldPath)) {
                const regular = fs_1.default.readFileSync(regPath);
                const semibold = fs_1.default.readFileSync(boldPath);
                logger_1.log.font.info({ source: fontDir, regular: reg }, '🔤 Bianco Sport cargada desde disco');
                _fontSetCache = { regular, semibold, source: 'bianco-sport' };
                return _fontSetCache;
            }
        }
    }
    // 3. Rajdhani (fallback fiel — fuente geométrica condensada, deportiva)
    logger_1.log.font.info('🔤 Bianco Sport no disponible → usando Rajdhani (fallback fiel)');
    return await cargarRajdhani();
}
async function cargarRajdhani() {
    const pesos = [
        { peso: 300, clave: 'light' },
        { peso: 400, clave: 'regular' },
        { peso: 500, clave: 'medium' },
        { peso: 600, clave: 'semibold' },
    ];
    const buffers = {};
    let source = 'rajdhani';
    for (const { peso, clave } of pesos) {
        // Preferir WOFF2, caer en WOFF
        const woff2 = rajdhaniFile(peso, 'woff2');
        const woff = rajdhaniFile(peso, 'woff');
        try {
            if (fs_1.default.existsSync(woff2)) {
                buffers[clave] = fs_1.default.readFileSync(woff2);
            }
            else if (fs_1.default.existsSync(woff)) {
                buffers[clave] = fs_1.default.readFileSync(woff);
            }
        }
        catch { /* skip this weight */ }
    }
    if (!buffers.regular) {
        // Último fallback: DejaVu Sans del sistema
        const dejaVuPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        const dejaVuBold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
        logger_1.log.font.warn('Rajdhani no disponible → usando DejaVu Sans (sistema)');
        buffers.regular = fs_1.default.readFileSync(dejaVuPath);
        buffers.semibold = fs_1.default.readFileSync(dejaVuBold);
        source = 'system';
    }
    const result = {
        light: buffers.light,
        regular: buffers.regular,
        medium: buffers.medium,
        semibold: buffers.semibold ?? buffers.regular,
        source,
    };
    logger_1.log.font.info({
        source,
        weights: Object.entries(buffers).map(([k, v]) => `${k}:${v.length}B`).join(' '),
    }, '✓ Fuentes cargadas');
    _fontSetCache = result;
    return result;
}
// ══════════════════════════════════════════════════════════
// API PÚBLICA
// ══════════════════════════════════════════════════════════
/** Invalidar caché (al actualizar la fuente en caliente) */
function invalidarCacheFuentes() {
    _fontSetCache = null;
    logger_1.log.font.info('🔤 Caché de fuentes invalidado');
}
/** Buffers de fuente para PDFKit */
async function getFontBuffers() {
    return cargarFuentes();
}
/**
 * CSS @font-face listo para embeber en el HTML de Puppeteer.
 * Incluye los 4 pesos como base64 inline (sin dependencias de red).
 */
async function getFontFaceCSS() {
    const fonts = await cargarFuentes();
    const toB64 = (buf, isWOFF2 = true) => `data:font/${isWOFF2 ? 'woff2' : 'ttf'};base64,${buf.toString('base64')}`;
    const weights = [
        [300, fonts.light, 'Light'],
        [400, fonts.regular, 'Regular'],
        [500, fonts.medium, 'Medium'],
        [600, fonts.semibold, 'SemiBold'],
    ];
    const faceDeclarations = weights
        .filter(([, buf]) => buf != null)
        .map(([weight, buf, label]) => `
/* ${exports.FONT_FAMILY} ${label} (${weight}) — embedded */
@font-face {
  font-family: '${exports.FONT_FAMILY}';
  src: url('${toB64(buf)}') format('woff2');
  font-weight: ${weight};
  font-style: normal;
  font-display: block;
}`)
        .join('\n');
    return faceDeclarations;
}
/** Info sobre la fuente actualmente cargada */
async function getFontInfo() {
    const fonts = await cargarFuentes();
    const weights = {};
    if (fonts.light)
        weights['300-light'] = fonts.light.length;
    if (fonts.regular)
        weights['400-regular'] = fonts.regular.length;
    if (fonts.medium)
        weights['500-medium'] = fonts.medium.length;
    if (fonts.semibold)
        weights['600-semibold'] = fonts.semibold.length;
    return {
        family: exports.FONT_FAMILY,
        source: fonts.source,
        weights,
        bytesTotal: Object.values(weights).reduce((a, b) => a + b, 0),
    };
}
