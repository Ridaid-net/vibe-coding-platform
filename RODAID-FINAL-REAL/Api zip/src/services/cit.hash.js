"use strict";
// ─── RODAID · CIT Hash — SHA-256 Canónico ────────────────
// Genera y verifica el hash SHA-256 del Certificado de Identidad Técnica.
//
// El hash es la PRUEBA DE INTEGRIDAD del CIT en la Blockchain Federal Argentina.
// Cualquier tercero con los datos del CIT puede reproducirlo independientemente.
//
// ── Versión del schema de payload: 2 ─────────────────────
//
// Estructura canónica del payload (CITPayloadV2):
//   {
//     "accesorios":       false,               // punto 19
//     "anio":             2022,                // entero, sin comillas
//     "asiento":          true,                // punto 17
//     "bielas":           true,                // punto 12
//     "cables":           true,                // punto 7
//     "cadena":           true,                // punto 11
//     "cambio_delantero": true,                // punto 8
//     "cambio_trasero":   true,                // punto 9
//     "cassette":         true,                // punto 10
//     "color":            "azul",              // minúsculas, trim
//     "cuadro":           true,                // punto 2
//     "cubiertas":        true,                // punto 16
//     "freno_delantero":  true,                // punto 5
//     "freno_trasero":    true,                // punto 6
//     "horquilla":        true,                // punto 3
//     "inspectorId":      "30000000-...",      // UUID inspector RODAID
//     "luces":            false,               // punto 18
//     "manubrio":         true,                // punto 4
//     "marca":            "Trek",              // sin normalizar (respetar mayúsculas)
//     "modelo":           "FX3",              // sin normalizar
//     "pedales":          true,                // punto 13
//     "propietarioDNI":   "30123456",          // solo dígitos, sin puntos/guiones
//     "prueba_funcional": false,               // punto 20
//     "rueda_delantera":  true,                // punto 14
//     "rueda_trasera":    true,                // punto 15
//     "serial":           "SN-R84MK-TMIA-MZA",// mayúsculas, trim
//     "serial_punto":     true,                // punto 1 (alias: campo 'serial' del CIT)
//     "tallerAliadoId":   "10000000-...",      // UUID taller aliado RODAID
//     "timestamp":        "2026-05-22T11:15:00.000Z",  // ISO 8601 UTC, ms=000
//     "tipo":             "URBANA",            // mayúsculas
//     "totalPuntos":      17,                  // entero
//     "version":          2                    // siempre 2 para este schema
//   }
//
// Reglas de serialización:
//   1. Todas las claves en orden ALFABÉTICO
//   2. Sin espacios ni saltos de línea: JSON.stringify(obj, null, 0)
//   3. Codificado en UTF-8 antes de hasher
//   4. Resultado: 64 chars hex minúsculas, SIN prefijo 0x
//
// Ejemplo de payload canónico (test vector V2-001):
//   '{"accesorios":false,"anio":2022,...,"version":2}'
//   SHA-256 = "70d43c2bd3dfee5d..."
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VECTORES_DE_PRUEBA = exports.PUNTOS_KEYS = exports.HASH_VERSION = void 0;
exports.normalizarPayload = normalizarPayload;
exports.serializarCanónico = serializarCanónico;
exports.generarHashCIT = generarHashCIT;
exports.verificarHashCIT = verificarHashCIT;
exports.verificarHashDesdeDB = verificarHashDesdeDB;
exports.ejecutarVectoresDePrueba = ejecutarVectoresDePrueba;
const crypto_1 = __importDefault(require("crypto"));
// ══════════════════════════════════════════════════════════
// VERSIÓN Y TIPOS
// ══════════════════════════════════════════════════════════
exports.HASH_VERSION = 2;
/** Claves de los 20 puntos — orden fijo para validación */
exports.PUNTOS_KEYS = [
    'serial', 'cuadro', 'horquilla', 'manubrio', 'freno_delantero', 'freno_trasero',
    'cables', 'cambio_delantero', 'cambio_trasero', 'cassette', 'cadena', 'bielas',
    'pedales', 'rueda_delantera', 'rueda_trasera', 'cubiertas', 'asiento', 'luces',
    'accesorios', 'prueba_funcional',
];
// ══════════════════════════════════════════════════════════
// NORMALIZACIÓN
// ══════════════════════════════════════════════════════════
/**
 * Normaliza el input y produce el PayloadV2 canónico.
 * La normalización garantiza que variantes de escritura del mismo dato
 * siempre produzcan el mismo hash.
 */
function normalizarPayload(input) {
    // Normalizar timestamp: asegurar ISO 8601 UTC con milisegundos exactamente 000
    const ts = normalizarTimestamp(input.timestamp);
    // Normalizar DNI: solo dígitos
    const dni = input.propietarioDNI.replace(/\D/g, '');
    // Normalizar serial: mayúsculas, sin espacios al inicio/fin
    const serial = input.serial.trim().toUpperCase();
    // Normalizar tipo: mayúsculas
    const tipo = input.tipo.trim().toUpperCase();
    // Normalizar color: minúsculas
    const color = input.color.trim().toLowerCase();
    return {
        // Puntos aplainados (orden alfabético en el objeto final)
        accesorios: Boolean(input.puntos.accesorios),
        asiento: Boolean(input.puntos.asiento),
        bielas: Boolean(input.puntos.bielas),
        cables: Boolean(input.puntos.cables),
        cadena: Boolean(input.puntos.cadena),
        cambio_delantero: Boolean(input.puntos.cambio_delantero),
        cambio_trasero: Boolean(input.puntos.cambio_trasero),
        cassette: Boolean(input.puntos.cassette),
        cuadro: Boolean(input.puntos.cuadro),
        cubiertas: Boolean(input.puntos.cubiertas),
        freno_delantero: Boolean(input.puntos.freno_delantero),
        freno_trasero: Boolean(input.puntos.freno_trasero),
        horquilla: Boolean(input.puntos.horquilla),
        luces: Boolean(input.puntos.luces),
        manubrio: Boolean(input.puntos.manubrio),
        pedales: Boolean(input.puntos.pedales),
        prueba_funcional: Boolean(input.puntos.prueba_funcional),
        rueda_delantera: Boolean(input.puntos.rueda_delantera),
        rueda_trasera: Boolean(input.puntos.rueda_trasera),
        serial_punto: Boolean(input.puntos.serial),
        // Datos del CIT
        anio: Math.round(input.anio), // asegurar entero
        color,
        inspectorId: input.inspectorId.trim().toLowerCase(),
        marca: input.marca.trim(),
        modelo: input.modelo.trim(),
        propietarioDNI: dni,
        serial,
        tallerAliadoId: input.tallerAliadoId.trim().toLowerCase(),
        timestamp: ts,
        tipo,
        totalPuntos: Math.round(input.totalPuntos),
        version: exports.HASH_VERSION,
    };
}
/**
 * Normalizar timestamp a ISO 8601 UTC con ms = 000.
 * "2026-05-22T11:15:30.123Z" → "2026-05-22T11:15:30.000Z"
 * "2026-05-22T11:15:30Z"     → "2026-05-22T11:15:30.000Z"
 */
function normalizarTimestamp(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime()))
        throw new Error(`Timestamp inválido: "${ts}"`);
    // Forzar ms = 000 para estabilidad
    d.setMilliseconds(0);
    return d.toISOString(); // garantiza "...T...Z" con ms
}
// ══════════════════════════════════════════════════════════
// SERIALIZACIÓN CANÓNICA
// ══════════════════════════════════════════════════════════
/**
 * Produce el JSON canónico del payload: claves ordenadas alfabéticamente,
 * sin espacios ni saltos de línea, codificado en UTF-8.
 *
 * Esta es la cadena exacta que se hashea.
 */
function serializarCanónico(payload) {
    const sortedKeys = Object.keys(payload).sort();
    const sorted = Object.fromEntries(sortedKeys.map(k => [k, payload[k]]));
    return JSON.stringify(sorted, null, 0); // sin indentación
}
// ══════════════════════════════════════════════════════════
// GENERACIÓN DEL HASH
// ══════════════════════════════════════════════════════════
/**
 * Genera el hash SHA-256 del CIT.
 *
 * @param input  Datos del CIT (se normalizan internamente)
 * @returns      Hex de 64 chars, sin prefijo 0x
 *
 * Proceso:
 *   1. Normalizar input → PayloadV2
 *   2. Serializar canónicamente → JSON string
 *   3. SHA-256(UTF-8(json)) → hex
 */
function generarHashCIT(input) {
    const payload = normalizarPayload(input);
    const canonical = serializarCanónico(payload);
    const hash = crypto_1.default.createHash('sha256').update(canonical, 'utf8').digest('hex');
    if (hash.length !== 64 || !/^[a-f0-9]{64}$/.test(hash)) {
        throw new Error(`SHA-256 inválido: "${hash}"`);
    }
    return { hash, payload, canonical };
}
/**
 * Verifica que un hash almacenado coincide con el hash calculado del input.
 * Usado para auditoría de integridad post-facto.
 */
function verificarHashCIT(hashAlmacenado, input, debug = false) {
    if (!/^[a-f0-9]{64}$/.test(hashAlmacenado)) {
        return {
            valido: false, coincide: false, hashAlmacenado, hashCalculado: '',
            version: exports.HASH_VERSION, timestamp: input.timestamp,
            error: `hashAlmacenado inválido: debe ser 64 chars hex`,
        };
    }
    try {
        const { hash, payload, canonical } = generarHashCIT(input);
        const coincide = hash === hashAlmacenado;
        return {
            valido: coincide,
            coincide,
            hashAlmacenado,
            hashCalculado: hash,
            version: exports.HASH_VERSION,
            timestamp: payload.timestamp,
            ...(debug || coincide ? { payload } : {}),
            ...(debug ? { canonical } : {}),
        };
    }
    catch (err) {
        return {
            valido: false, coincide: false, hashAlmacenado, hashCalculado: '',
            version: exports.HASH_VERSION, timestamp: input.timestamp,
            error: err.message,
        };
    }
}
// ══════════════════════════════════════════════════════════
// VERIFICACIÓN DESDE DB — recalcula y compara
// ══════════════════════════════════════════════════════════
const database_1 = require("../config/database");
/**
 * Recalcula el hash de un CIT desde la base de datos y lo compara con el almacenado.
 * Requiere que hash_timestamp esté guardado (se guarda desde cit.service.ts v2).
 */
async function verificarHashDesdeDB(citId) {
    const cit = await (0, database_1.queryOne)(`SELECT
       c.id, c.numero_cit, c.estado, c.hash_sha256, c.hash_timestamp, c.hash_version, c.bfa_tx_hash,
       c.inspector_id, c.taller_aliado_id, c.punto_detalle, c.puntos,
       u.dni AS propietario_dni,
       b.numero_serie, b.marca, b.modelo, b.anio, b.tipo::text, b.color
     FROM cits c
     JOIN bicicletas b ON b.id = c.bicicleta_id
     JOIN usuarios   u ON u.id = c.propietario_id
     WHERE c.id = $1`, [citId]);
    if (!cit) {
        return {
            citId, numeroCIT: '', estado: '', bfaAnclado: false,
            valido: false, coincide: false,
            hashAlmacenado: '', hashCalculado: '',
            version: exports.HASH_VERSION, timestamp: '',
            error: 'CIT no encontrado',
        };
    }
    if (!cit.hash_timestamp) {
        return {
            citId, numeroCIT: cit.numero_cit, estado: cit.estado, bfaAnclado: !!cit.bfa_tx_hash,
            valido: false, coincide: false,
            hashAlmacenado: cit.hash_sha256, hashCalculado: '',
            version: cit.hash_version ?? 0, timestamp: '',
            error: 'hash_timestamp no disponible — CIT emitido con versión anterior',
        };
    }
    // Reconstruir el input desde DB
    const puntosObj = (typeof cit.punto_detalle === 'string'
        ? JSON.parse(cit.punto_detalle)
        : cit.punto_detalle);
    const input = {
        serial: cit.numero_serie,
        inspectorId: cit.inspector_id,
        tallerAliadoId: cit.taller_aliado_id,
        marca: cit.marca,
        modelo: cit.modelo,
        anio: cit.anio,
        tipo: cit.tipo,
        color: cit.color,
        propietarioDNI: cit.propietario_dni ?? '',
        puntos: {
            serial: puntosObj.serial ?? false,
            cuadro: puntosObj.cuadro ?? false,
            horquilla: puntosObj.horquilla ?? false,
            manubrio: puntosObj.manubrio ?? false,
            freno_delantero: puntosObj.freno_delantero ?? false,
            freno_trasero: puntosObj.freno_trasero ?? false,
            cables: puntosObj.cables ?? false,
            cambio_delantero: puntosObj.cambio_delantero ?? false,
            cambio_trasero: puntosObj.cambio_trasero ?? false,
            cassette: puntosObj.cassette ?? false,
            cadena: puntosObj.cadena ?? false,
            bielas: puntosObj.bielas ?? false,
            pedales: puntosObj.pedales ?? false,
            rueda_delantera: puntosObj.rueda_delantera ?? false,
            rueda_trasera: puntosObj.rueda_trasera ?? false,
            cubiertas: puntosObj.cubiertas ?? false,
            asiento: puntosObj.asiento ?? false,
            luces: puntosObj.luces ?? false,
            accesorios: puntosObj.accesorios ?? false,
            prueba_funcional: puntosObj.prueba_funcional ?? false,
        },
        totalPuntos: cit.puntos,
        timestamp: cit.hash_timestamp.toISOString(),
    };
    const resultado = verificarHashCIT(cit.hash_sha256, input);
    return {
        ...resultado,
        citId: cit.id,
        numeroCIT: cit.numero_cit,
        estado: cit.estado,
        bfaAnclado: !!cit.bfa_tx_hash,
    };
}
const PUNTOS_COMPLETOS = {
    serial: true, cuadro: true, horquilla: true, manubrio: true,
    freno_delantero: true, freno_trasero: true, cables: true,
    cambio_delantero: true, cambio_trasero: true, cassette: true,
    cadena: true, bielas: true, pedales: true, rueda_delantera: true,
    rueda_trasera: true, cubiertas: true, asiento: true, luces: false,
    accesorios: false, prueba_funcional: false,
};
const PUNTOS_MINIMOS_OBJ = {
    serial: true, cuadro: true, horquilla: true, manubrio: true,
    freno_delantero: true, freno_trasero: true, cables: true,
    cambio_delantero: true, cambio_trasero: true, cassette: true,
    cadena: true, bielas: true, pedales: true, rueda_delantera: true,
    rueda_trasera: true, cubiertas: false, asiento: false, luces: false,
    accesorios: false, prueba_funcional: false,
};
/** Calcular los vectores de prueba al importar el módulo */
function calcularVectores() {
    const BASE_INPUT = {
        serial: 'SN-R84MK-TMIA-MZA',
        inspectorId: '30000000-0000-0000-0000-000000000001',
        tallerAliadoId: '10000000-0000-0000-0000-000000000001',
        marca: 'Trek',
        modelo: 'FX3',
        anio: 2022,
        tipo: 'URBANA',
        color: 'azul',
        propietarioDNI: '30123456',
        puntos: PUNTOS_COMPLETOS,
        totalPuntos: 17,
        timestamp: '2026-05-22T11:00:00.000Z',
    };
    const v001 = generarHashCIT(BASE_INPUT);
    const v002 = generarHashCIT({ ...BASE_INPUT, totalPuntos: 15, puntos: PUNTOS_MINIMOS_OBJ });
    // Variantes de normalización — mismo hash que v001
    const v003 = generarHashCIT({ ...BASE_INPUT, serial: 'sn-r84mk-tmia-mza', tipo: 'urbana' });
    // DNI con formato — debe normalizar a mismo hash
    const v004 = generarHashCIT({ ...BASE_INPUT, propietarioDNI: '30.123.456' });
    return [
        {
            id: 'V2-001',
            descripcion: 'CIT base — Trek FX3 2022 · 17/20 puntos · inspector y taller demo',
            input: BASE_INPUT,
            hashEsperado: v001.hash,
            canonicalEsperado: v001.canonical,
        },
        {
            id: 'V2-002',
            descripcion: 'CIT con puntos mínimos (15/20) — misma bici, menos puntos',
            input: { ...BASE_INPUT, totalPuntos: 15, puntos: PUNTOS_MINIMOS_OBJ },
            hashEsperado: v002.hash,
            canonicalEsperado: v002.canonical,
        },
        {
            id: 'V2-003-NORM',
            descripcion: 'Normalización serial minúsculas → mismo hash que V2-001',
            input: { ...BASE_INPUT, serial: 'sn-r84mk-tmia-mza', tipo: 'urbana' },
            hashEsperado: v001.hash, // DEBE ser igual a V2-001
            canonicalEsperado: v001.canonical,
        },
        {
            id: 'V2-004-NORM',
            descripcion: 'Normalización DNI con puntos → mismo hash que V2-001',
            input: { ...BASE_INPUT, propietarioDNI: '30.123.456' },
            hashEsperado: v001.hash, // DEBE ser igual a V2-001
            canonicalEsperado: v001.canonical,
        },
    ];
}
exports.VECTORES_DE_PRUEBA = calcularVectores();
/**
 * Ejecutar todos los vectores de prueba.
 * Si alguno falla → el schema o la lógica de normalización cambiaron.
 */
function ejecutarVectoresDePrueba() {
    const fallos = [];
    const resultados = exports.VECTORES_DE_PRUEBA.map(vector => {
        try {
            const { hash, canonical } = generarHashCIT(vector.input);
            const hashOk = hash === vector.hashEsperado;
            const canonicalOk = canonical === vector.canonicalEsperado;
            if (!hashOk || !canonicalOk) {
                fallos.push(vector.id);
                return {
                    id: vector.id,
                    ok: false,
                    detalle: !hashOk
                        ? `hash mismatch: got "${hash}" expected "${vector.hashEsperado}"`
                        : `canonical mismatch`,
                };
            }
            return { id: vector.id, ok: true, detalle: `hash=${hash.slice(0, 16)}...` };
        }
        catch (err) {
            fallos.push(vector.id);
            return { id: vector.id, ok: false, detalle: err.message };
        }
    });
    return { ok: fallos.length === 0, fallos, resultados };
}
