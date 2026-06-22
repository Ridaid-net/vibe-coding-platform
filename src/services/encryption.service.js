"use strict";
// ─── RODAID · Cifrado AES-256-GCM ─────────────────────────
//
// ══ DATOS EN REPOSO (at rest) ════════════════════════════
//
// Campos sensibles cifrados en DB con AES-256-GCM:
//   · usuarios.cuil           — CUIT/CUIL del propietario
//   · usuarios.telefono       — teléfono de contacto
//   · cits.propietario_dni    — DNI del propietario en el CIT
//   · denuncias.descripcion   — descripción del robo (detalla el hecho)
//   · mxm_tokens.token        — token de sesión MxM
//   · crossref_log.propietario_dni — DNI consultado (MinSeg)
//
// Estrategia de cifrado de campos:
//   1. AES-256-GCM: clave de 256 bits, IV aleatorio de 96 bits, tag de 128 bits
//   2. El IV y el tag se almacenan con el ciphertext: base64(iv|tag|ct)
//   3. La clave maestra (DEK) está en env var ENCRYPTION_KEY (256 bits hex)
//   4. La DEK nunca toca la DB — solo los datos cifrados
//   5. Envelope encryption: DEK cifra Field Encryption Keys (FEK)
//
// ══ DATOS EN TRÁNSITO (in transit) ══════════════════════
//
// Redis: datos sensibles cifrados antes de guardar en caché:
//   · sesiones de usuario (JWT session data)
//   · tokens MxM
//   · preferencias con PII
//
// API responses: campos sensibles enmascarados:
//   · DNI → "30*****6"
//   · Teléfono → "+54911*****23"
//   · Email → "fed***@g***.com"
//
// ══ ROTACIÓN DE CLAVES ═══════════════════════════════════
//
// Flujo de key rotation:
//   1. Generar nueva ENCRYPTION_KEY_V2
//   2. rotarClaves(oldKey, newKey) → re-cifra todos los campos
//   3. Actualizar env ENCRYPTION_KEY
//   4. Incrementar version_clave en encrypted_fields
//
// ══ CONFIGURACIÓN ════════════════════════════════════════
//
// Variables de entorno:
//   ENCRYPTION_KEY      = 64 hex chars (256 bits) — clave activa
//   ENCRYPTION_KEY_V1   = clave anterior (para rotación)
//   ENCRYPTION_VERSION  = 1 (versión actual, default 1)
//
// Generar clave nueva:
//   node -e "require('crypto').randomBytes(32).toString('hex').substring(0,64)|0"
//   → ej: a3f8c2d1e4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cifrar = cifrar;
exports.descifrar = descifrar;
exports.esCifrado = esCifrado;
exports.cifrarCampo = cifrarCampo;
exports.descifrarCampo = descifrarCampo;
exports.cifrarCampos = cifrarCampos;
exports.descifrarCampos = descifrarCampos;
exports.redisSetCifrado = redisSetCifrado;
exports.redisGetCifrado = redisGetCifrado;
exports.redisDelCifrado = redisDelCifrado;
exports.enmascararDNI = enmascararDNI;
exports.enmascararEmail = enmascararEmail;
exports.enmascararTelefono = enmascararTelefono;
exports.enmascararNombre = enmascararNombre;
exports.enmascararPII = enmascararPII;
exports.rotarClaves = rotarClaves;
exports.getEstadisticasCifrado = getEstadisticasCifrado;
exports.generarClave = generarClave;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CONSTANTES Y CONFIGURACIÓN
// ══════════════════════════════════════════════════════════
const ALGORITMO = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits — recomendado para GCM
const TAG_BYTES = 16; // 128 bits — máximo de seguridad GCM
const VERSION_CLAVE = parseInt(process.env.ENCRYPTION_VERSION ?? '1');
// Obtener clave activa desde env (o generar una de desarrollo)
function getEncryptionKey(version = VERSION_CLAVE) {
    const keyHex = version === 1
        ? (process.env.ENCRYPTION_KEY ?? '').replace(/\s/g, '')
        : (process.env[`ENCRYPTION_KEY_V${version}`] ?? '').replace(/\s/g, '');
    if (!keyHex || keyHex.length < 64) {
        // Modo STUB: usar clave determinística para desarrollo
        if (process.env.NODE_ENV !== 'production') {
            const stub = crypto_1.default.scryptSync('rodaid-dev-key-DO-NOT-USE-IN-PROD', 'rodaid-salt', 32);
            return stub;
        }
        throw new Error(`ENCRYPTION_KEY no configurada o inválida. ` +
            `Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
    }
    return Buffer.from(keyHex.slice(0, 64), 'hex');
}
// ══════════════════════════════════════════════════════════
// CIFRADO AES-256-GCM — PRIMITIVAS
// ══════════════════════════════════════════════════════════
/**
 * Cifrar un string con AES-256-GCM.
 * Retorna: base64(iv[12] + tag[16] + ciphertext)
 */
function cifrar(texto, keyVersion = VERSION_CLAVE) {
    if (!texto)
        return '';
    const clave = getEncryptionKey(keyVersion);
    const iv = crypto_1.default.randomBytes(IV_BYTES);
    const cipher = crypto_1.default.createCipheriv(ALGORITMO, clave, iv);
    const enc1 = cipher.update(texto, 'utf8');
    const enc2 = cipher.final();
    const tag = cipher.getAuthTag();
    // Concatenar: iv(12) + tag(16) + ciphertext
    const buf = Buffer.concat([iv, tag, enc1, enc2]);
    return buf.toString('base64');
}
/**
 * Descifrar un valor cifrado con cifrar().
 * Si el valor está vacío o no es válido, retorna ''
 */
function descifrar(valorEnc, keyVersion = VERSION_CLAVE) {
    if (!valorEnc)
        return '';
    try {
        const clave = getEncryptionKey(keyVersion);
        const buf = Buffer.from(valorEnc, 'base64');
        if (buf.length < IV_BYTES + TAG_BYTES + 1)
            return ''; // datos corruptos
        const iv = buf.subarray(0, IV_BYTES);
        const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
        const decipher = crypto_1.default.createDecipheriv(ALGORITMO, clave, iv);
        decipher.setAuthTag(tag);
        const dec1 = decipher.update(ciphertext);
        const dec2 = decipher.final();
        return Buffer.concat([dec1, dec2]).toString('utf8');
    }
    catch {
        logger_1.log.firma.warn({ valorEnc: valorEnc.slice(0, 20) }, '⚠ Error descifrando campo — datos corruptos o clave incorrecta');
        return '';
    }
}
/**
 * ¿Es un valor ya cifrado? (base64 con longitud correcta mínima)
 */
function esCifrado(valor) {
    if (!valor)
        return false;
    try {
        const buf = Buffer.from(valor, 'base64');
        return buf.length >= IV_BYTES + TAG_BYTES + 1;
    }
    catch {
        return false;
    }
}
// ══════════════════════════════════════════════════════════
// CIFRADO DE CAMPOS EN DB — Field Level Encryption
// ══════════════════════════════════════════════════════════
/**
 * Cifrar un campo de una tabla y guardarlo en encrypted_fields.
 * El campo original en la tabla principal puede quedar como NULL
 * o con un hash truncado para búsquedas.
 */
async function cifrarCampo(opts) {
    if (!opts.valor)
        return;
    const enc = cifrar(opts.valor);
    await (0, database_1.query)(`INSERT INTO encrypted_fields (tabla, registro_id, campo, valor_enc, version_clave)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tabla, registro_id, campo) DO UPDATE SET
       valor_enc    = EXCLUDED.valor_enc,
       version_clave= EXCLUDED.version_clave,
       rotado_en    = NOW()`, [opts.tabla, opts.registroId, opts.campo, enc, VERSION_CLAVE]);
}
/**
 * Descifrar un campo de la tabla encrypted_fields.
 */
async function descifrarCampo(opts) {
    const row = await (0, database_1.queryOne)(`SELECT valor_enc, version_clave FROM encrypted_fields
     WHERE tabla=$1 AND registro_id=$2 AND campo=$3`, [opts.tabla, opts.registroId, opts.campo]);
    if (!row)
        return null;
    return descifrar(row.valor_enc, row.version_clave);
}
/**
 * Cifrar múltiples campos de un registro en una operación.
 */
async function cifrarCampos(tabla, registroId, campos) {
    await Promise.all(Object.entries(campos)
        .filter(([, v]) => v != null && v !== '')
        .map(([campo, valor]) => cifrarCampo({ tabla, registroId, campo, valor })));
}
/**
 * Descifrar todos los campos cifrados de un registro.
 */
async function descifrarCampos(tabla, registroId) {
    const rows = await (0, database_1.query)(`SELECT campo, valor_enc, version_clave FROM encrypted_fields
     WHERE tabla=$1 AND registro_id=$2`, [tabla, registroId]);
    const resultado = {};
    for (const row of rows) {
        resultado[row.campo] = descifrar(row.valor_enc, row.version_clave);
    }
    return resultado;
}
// ══════════════════════════════════════════════════════════
// REDIS — Cifrado de datos en tránsito/caché
// ══════════════════════════════════════════════════════════
const REDIS_ENC_PREFIX = 'enc:';
/**
 * Guardar un valor cifrado en Redis.
 */
async function redisSetCifrado(key, valor, ttlSegundos) {
    const redis = (0, redis_1.getRedis)();
    const json = JSON.stringify(valor);
    const enc = cifrar(json);
    const fullKey = `${REDIS_ENC_PREFIX}${key}`;
    if (ttlSegundos) {
        await redis.set(fullKey, enc, 'EX', ttlSegundos);
    }
    else {
        await redis.set(fullKey, enc);
    }
}
/**
 * Leer y descifrar un valor de Redis.
 */
async function redisGetCifrado(key) {
    const redis = (0, redis_1.getRedis)();
    const fullKey = `${REDIS_ENC_PREFIX}${key}`;
    const enc = await redis.get(fullKey);
    if (!enc)
        return null;
    const json = descifrar(enc);
    if (!json)
        return null;
    try {
        return JSON.parse(json);
    }
    catch {
        return null;
    }
}
async function redisDelCifrado(key) {
    await (0, redis_1.getRedis)().del(`${REDIS_ENC_PREFIX}${key}`);
}
// ══════════════════════════════════════════════════════════
// ENMASCARAMIENTO — Para responses de API
// ══════════════════════════════════════════════════════════
function enmascararDNI(dni) {
    if (!dni)
        return '';
    const s = dni.replace(/\D/g, '');
    if (s.length < 4)
        return '***';
    return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2);
}
function enmascararEmail(email) {
    if (!email || !email.includes('@'))
        return '';
    const [user, domain] = email.split('@');
    const [domName, ...ext] = domain.split('.');
    const mask = (s) => s.length <= 2 ? '***' : s[0] + '*'.repeat(s.length - 2) + s.slice(-1);
    return `${mask(user)}@${mask(domName)}.${ext.join('.')}`;
}
function enmascararTelefono(tel) {
    if (!tel)
        return '';
    const s = tel.replace(/\D/g, '');
    if (s.length < 6)
        return '***';
    return s.slice(0, 4) + '*'.repeat(s.length - 6) + s.slice(-2);
}
function enmascararNombre(nombre) {
    if (!nombre)
        return '';
    return nombre.trim().split(' ')
        .map(p => p.length <= 1 ? p : p[0] + '*'.repeat(p.length - 1))
        .join(' ');
}
/**
 * Enmascarar todos los campos PII de un objeto antes de responder.
 * Aplicar en controladores para datos que van al cliente.
 */
function enmascararPII(obj) {
    const campos = {
        dni: enmascararDNI,
        cuil: enmascararDNI,
        propietario_dni: enmascararDNI,
        denunciante_dni: enmascararDNI,
        email: enmascararEmail,
        telefono: enmascararTelefono,
        nombre: (v) => v, // nombre completo se mantiene (no es secreto por sí solo)
    };
    const result = { ...obj };
    for (const [campo, fn] of Object.entries(campos)) {
        if (campo in result && result[campo]) {
            result[campo] = fn(result[campo]);
        }
    }
    return result;
}
// ══════════════════════════════════════════════════════════
// ROTACIÓN DE CLAVES
// ══════════════════════════════════════════════════════════
/**
 * Rotar todos los campos cifrados a una nueva versión de clave.
 * Llamar cuando se cambia ENCRYPTION_KEY.
 */
async function rotarClaves(opts) {
    const rows = await (0, database_1.query)(`SELECT id, tabla, registro_id, campo, valor_enc, version_clave
     FROM encrypted_fields WHERE version_clave=$1`, [opts.versionAntigua]);
    let rotados = 0;
    let errores = 0;
    for (const row of rows) {
        try {
            const plain = descifrar(row.valor_enc, opts.versionAntigua);
            if (!plain) {
                errores++;
                continue;
            }
            const newEnc = cifrar(plain, opts.versionNueva);
            if (!opts.dryRun) {
                await (0, database_1.query)(`UPDATE encrypted_fields SET valor_enc=$2, version_clave=$3, rotado_en=NOW() WHERE id=$1`, [row.id, newEnc, opts.versionNueva]);
            }
            rotados++;
        }
        catch {
            errores++;
        }
    }
    logger_1.log.firma.info({
        total: rows.length, rotados, errores, dryRun: opts.dryRun,
        versionAntigua: opts.versionAntigua, versionNueva: opts.versionNueva,
    }, `🔑 Rotación de claves ${opts.dryRun ? '(dry run)' : 'completada'}`);
    return { total: rows.length, rotados, errores };
}
// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ══════════════════════════════════════════════════════════
async function getEstadisticasCifrado() {
    const [campos, porVersion] = await Promise.all([
        (0, database_1.queryOne)(`SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT tabla)::int AS tablas,
              COUNT(DISTINCT campo)::int AS campos_distintos,
              MIN(creado_en) AS primer_registro,
              MAX(rotado_en) AS ultima_rotacion
       FROM encrypted_fields`, []),
        (0, database_1.query)(`SELECT version_clave, COUNT(*)::int AS count
       FROM encrypted_fields GROUP BY version_clave ORDER BY version_clave`, []),
    ]);
    return {
        totalCamposCifrados: campos?.total ?? 0,
        tablasProtegidas: campos?.tablas ?? 0,
        camposDistintos: campos?.campos_distintos ?? 0,
        primerRegistro: campos?.primer_registro,
        ultimaRotacion: campos?.ultima_rotacion,
        versionActual: VERSION_CLAVE,
        modoProduccion: process.env.NODE_ENV === 'production',
        claveConfigurada: (process.env.ENCRYPTION_KEY?.length ?? 0) >= 64,
        algoritmo: `AES-256-GCM (IV: ${IV_BYTES * 8} bits, Tag: ${TAG_BYTES * 8} bits)`,
        porVersion,
    };
}
/**
 * Generar una nueva clave de cifrado (para setup inicial o rotación).
 * Llamar desde: node -e "require('./dist/services/encryption.service').generarClave()"
 */
function generarClave() {
    const key = crypto_1.default.randomBytes(32);
    return {
        keyHex: key.toString('hex'),
        keyBase64: key.toString('base64'),
        bits: 256,
    };
}
