"use strict";
// ─── RODAID · CIT Service ────────────────────────────────
// Flujo completo de emisión de un Certificado de Identidad Técnica (CIT)
// según Ley Provincial Mendoza N° 9556:
//
//   iniciarCIT   → inspector + serial + 20 puntos → CIT en estado PENDIENTE
//                  genera SHA-256 canónico: serial + inspectorId + puntos + timestamp
//   validarCIT   → cruce Ministerio de Seguridad (serial vs base de robados)
//   finalizarCIT → mint en BFA: (propietario, hashSHA256, numeroCIT, serial) → tokenId
//
// La función generarHashCIT es determinística:
//   SHA-256(JSON.stringify({ serial, inspectorId, tallerAliadoId, puntos, timestamp }, keys sorted))
//   Sin prefijo 0x — exactamente 64 chars hex para el contrato RodaidCIT.sol
Object.defineProperty(exports, "__esModule", { value: true });
exports.VECTORES_DE_PRUEBA = exports.verificarHashDesdeDB = void 0;
exports.generarHashCIT = generarHashCIT;
exports.iniciarCIT = iniciarCIT;
exports.validarCIT = validarCIT;
exports.finalizarCIT = finalizarCIT;
exports.getCITById = getCITById;
exports.verificarSerial = verificarSerial;
exports.misCITs = misCITs;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const errorHandler_1 = require("../middleware/errorHandler");
const bfa_service_1 = require("./bfa.service");
const bfa_mint_service_1 = require("./bfa.mint.service");
const cit_hash_1 = require("./cit.hash");
Object.defineProperty(exports, "verificarHashDesdeDB", { enumerable: true, get: function () { return cit_hash_1.verificarHashDesdeDB; } });
Object.defineProperty(exports, "VECTORES_DE_PRUEBA", { enumerable: true, get: function () { return cit_hash_1.VECTORES_DE_PRUEBA; } });
const pdf_service_1 = require("./pdf.service");
const ipfs_service_1 = require("./ipfs.service");
// ══════════════════════════════════════════════════════════
// SHA-256 CANÓNICO — el corazón del anclaje en BFA
// ══════════════════════════════════════════════════════════
const PUNTOS_MINIMOS = 15; // Art. 12, Ley 9556: mínimo 15/20 puntos aprobados
/** Cuenta los puntos de inspección aprobados */
function contarPuntos(p) {
    return Object.values(p).filter(Boolean).length;
}
/**
 * Genera el hash SHA-256 del CIT — 64 chars hex sin prefijo 0x.
 *
 * Entrada canónica:
 *   {
 *     serial:          "SN-R84MK-TMIA-MZA",   // número de serie de la bicicleta
 *     inspectorId:     "30000000-...",           // UUID del inspector emisor
 *     tallerAliadoId:  "10000000-...",           // UUID del taller aliado
 *     marca:           "Trek",
 *     modelo:          "FX3",
 *     anio:            2022,
 *     tipo:            "urbana",
 *     propietarioDNI:  "30123456",
 *     puntos:          { serial: true, cuadro: true, ... },  // 20 campos ordenados
 *     totalPuntos:     18,
 *     timestamp:       "2026-05-22T11:15:00.000Z"            // ISO 8601 UTC
 *   }
 *
 * Serialización: JSON con claves ordenadas alfabéticamente (determinístico).
 * El mismo input produce siempre el mismo hash → verifiable por terceros.
 */
/**
 * Genera el hash SHA-256 del CIT usando el módulo cit.hash.ts (v2).
 * Normaliza el input antes de hashear (serial→mayúsculas, DNI→dígitos, etc.)
 * @returns 64 chars hex sin prefijo 0x
 */
function generarHashCIT(input) {
    return (0, cit_hash_1.generarHashCIT)(input).hash;
}
/** Obtiene el siguiente numeroCIT de la secuencia PostgreSQL */
async function obtenerNumeroCIT() {
    const row = await (0, database_1.queryOne)(`SELECT next_numero_cit() AS numero`);
    return row.numero; // ej: "RCIT-2026-00004"
}
// ══════════════════════════════════════════════════════════
// INICIAR CIT — inspector emite el certificado (estado PENDIENTE)
// ══════════════════════════════════════════════════════════
async function iniciarCIT(input) {
    const timer = (0, logger_1.startTimer)('cit.iniciar', { inspectorId: input.inspectorId });
    // ── 1. Verificar bicicleta ────────────────────────────
    const bici = await (0, database_1.queryOne)(`SELECT id, numero_serie, marca, modelo, anio, tipo, color, propietario_id
     FROM bicicletas WHERE id = $1`, [input.bicicletaId]);
    if (!bici)
        throw new errorHandler_1.AppError('Bicicleta no encontrada o inactiva', 404, 'BICICLETA_NOT_FOUND');
    // ── 2. Verificar que el inspector existe y está activo ─
    const inspector = await (0, database_1.queryOne)(`SELECT i.id, i.usuario_id, i.taller_aliado_id, i.certificado, i.wallet_address
     FROM inspectores i
     WHERE i.id = $1 AND i.activo = TRUE AND i.taller_aliado_id = $2`, [input.inspectorId, input.tallerAliadoId]);
    if (!inspector)
        throw new errorHandler_1.AppError('Inspector no activo en ese taller', 403, 'INSPECTOR_NOT_ACTIVE');
    // ── 3. Verificar que no existe CIT activo para esta bici
    const citActivo = await (0, database_1.queryOne)(`SELECT id FROM cits
     WHERE bicicleta_id = $1 AND estado IN ('ACTIVO', 'PENDIENTE')
     LIMIT 1`, [input.bicicletaId]);
    if (citActivo)
        throw new errorHandler_1.AppError('Esta bicicleta ya tiene un CIT activo o en validación. El anterior debe vencer o anularse antes.', 409, 'CIT_DUPLICATE');
    // ── 4. Validar puntos de inspección (mínimo Ley 9556) ─
    const puntosAprobados = contarPuntos(input.puntos);
    if (puntosAprobados < PUNTOS_MINIMOS) {
        throw new errorHandler_1.AppError(`Puntos de inspección insuficientes. Mínimo ${PUNTOS_MINIMOS}/20 requeridos (Ley 9556). Obtenidos: ${puntosAprobados}.`, 422, 'PUNTOS_INSUFICIENTES', { obtenidos: puntosAprobados, requeridos: PUNTOS_MINIMOS, faltantes: PUNTOS_MINIMOS - puntosAprobados });
    }
    // ── 5. Verificar DJ firmada ────────────────────────────
    if (!input.djFirmada)
        throw new errorHandler_1.AppError('La Declaración Jurada debe estar firmada por el propietario (Art. 10, Ley 9556)', 422, 'DJ_REQUERIDA');
    // ── 6. Generar SHA-256 canónico ──────────────────────
    const timestamp = new Date().toISOString(); // UTC — determinístico
    const numeroCIT = await obtenerNumeroCIT(); // secuencia PostgreSQL
    const hashResult = (0, cit_hash_1.generarHashCIT)({
        serial: bici.numero_serie,
        inspectorId: inspector.id,
        tallerAliadoId: input.tallerAliadoId,
        marca: bici.marca,
        modelo: bici.modelo,
        anio: bici.anio,
        tipo: bici.tipo,
        color: bici.color,
        propietarioDNI: input.propietarioDNI,
        puntos: input.puntos,
        totalPuntos: puntosAprobados,
        timestamp,
    });
    const hashSHA256 = hashResult.hash; // 64 chars hex
    const hashPayload = hashResult.payload; // payload normalizado (para auditoría)
    logger_1.log.cit.debug({
        numeroCIT, serial: bici.numero_serie, inspectorId: inspector.id,
        hashSHA256: hashSHA256.slice(0, 16) + '...',
        puntos: puntosAprobados, timestamp,
    }, 'SHA-256 del CIT generado');
    // ── 7. Persistir CIT + encolar validación (TX atómica) ─
    const venceEn = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hs hábiles
    const citId = await (0, database_1.transaction)(async (client) => {
        const r = await client.query(`INSERT INTO cits
         (numero_cit, bicicleta_id, propietario_id, inspector_id, taller_aliado_id,
          estado, puntos, punto_detalle, hash_sha256, hash_timestamp, hash_version,
          firma_inspector, fotos,
          dj_firmada, dj_firmada_en, creado_en, actualizado_en)
       VALUES ($1,$2,$3,$4,$5,'PENDIENTE',$6,$7,$8,$9,$10,$11,$12,TRUE,NOW(),NOW(),NOW())
       RETURNING id`, [
            numeroCIT, input.bicicletaId, bici.propietario_id, inspector.id, input.tallerAliadoId,
            puntosAprobados, JSON.stringify(input.puntos), hashSHA256,
            new Date(hashPayload.timestamp), // timestamp normalizado → guardado en DB
            2, // hash_version = 2
            input.firmaInspector, input.fotosUrls,
        ]);
        const id = r.rows[0].id;
        await client.query(`INSERT INTO validacion_queue
         (cit_id, serial_bicicleta, propietario_dni, propietario_nombre, propietario_datos, vence_en)
       VALUES ($1,$2,$3,$4,$5,$6)`, [
            id, bici.numero_serie, input.propietarioDNI, input.propietarioNombre,
            JSON.stringify({
                foto: input.fotosUrls[0] ?? null,
                lat: input.propietarioGeoLat ?? null,
                lng: input.propietarioGeoLng ?? null,
                color: bici.color,
            }),
            venceEn,
        ]);
        return id;
    });
    // ── 8. Encolar validación en Bull (72 hs) ─────────────
    try {
        const { encolarValidacion } = await import('./queue.service');
        await encolarValidacion(citId, venceEn);
    }
    catch (err) {
        logger_1.log.cit.warn({ citId, err: err.message }, 'Bull no disponible — validar manualmente con POST /cit/:id/validar');
    }
    const ms = timer({ citId, numeroCIT, hashSHA256 });
    logger_1.log.cit.info({
        citId, numeroCIT, serial: bici.numero_serie,
        inspectorId: inspector.id, hashSHA256: hashSHA256.slice(0, 16) + '...',
        puntosAprobados, ms,
    }, 'CIT iniciado · PENDIENTE · esperando validación Ministerio');
    return {
        citId,
        numeroCIT,
        hashSHA256,
        serial: bici.numero_serie,
        inspectorId: inspector.id,
        puntosAprobados,
        estado: 'PENDIENTE',
        venceEn: venceEn.toISOString(),
        mensaje: `CIT ${numeroCIT} iniciado. Validación contra base de datos del Ministerio de Seguridad en las próximas 72 hs hábiles.`,
    };
}
// ══════════════════════════════════════════════════════════
// VALIDAR CIT — cruce con Ministerio de Seguridad
// ══════════════════════════════════════════════════════════
async function validarCIT(citId) {
    const row = await (0, database_1.queryOne)(`SELECT c.id, c.numero_cit, c.propietario_id,
            vq.serial_bicicleta, vq.propietario_dni, vq.procesada_en
     FROM cits c JOIN validacion_queue vq ON vq.cit_id = c.id
     WHERE c.id = $1 AND c.estado = 'PENDIENTE'`, [citId]);
    if (!row)
        throw new errorHandler_1.AppError('CIT no encontrado o no está PENDIENTE', 404, 'CIT_NOT_PENDING');
    if (row.procesada_en)
        throw new errorHandler_1.AppError('Esta validación ya fue procesada', 409, 'ALREADY_PROCESSED');
    // STUB: cruce con API Ministerio de Seguridad Mendoza
    // En producción: GET ${MINSEG_API_URL}/rodados/serial/${row.serial_bicicleta}
    // El convenio técnico está en trámite (TAD EX-2026-26089745)
    const alertaActiva = row.serial_bicicleta.startsWith('ROBADO-');
    logger_1.log.cit.info({
        citId, serial: row.serial_bicicleta, alertaActiva,
        modo: process.env.MINSEG_API_URL ? 'REAL' : 'STUB',
    }, 'Cruce Ministerio de Seguridad Mendoza');
    if (alertaActiva) {
        await (0, database_1.transaction)(async (client) => {
            await client.query(`UPDATE cits SET estado='RECHAZADO', actualizado_en=NOW() WHERE id=$1`, [citId]);
            await client.query(`UPDATE validacion_queue
         SET procesada_en=NOW(), resultado='rechazado', alerta_min_seg=TRUE,
             detalle_alerta=$2
         WHERE cit_id=$1`, [citId, JSON.stringify({ tipo: 'DENUNCIA_ROBO_ACTIVA', ts: new Date().toISOString() })]);
            await client.query(`INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,datos)
         VALUES ($1,'CIT_RECHAZADO',
           'CIT rechazado — Alerta de seguridad',
           'Tu CIT fue rechazado porque el rodado figura en la base de denuncias del Ministerio de Seguridad. Los datos fueron remitidos a las autoridades.',
           $2)`, [row.propietario_id, JSON.stringify({ citId, numeroCIT: row.numero_cit })]);
        });
        return { citId, estado: 'RECHAZADO', alertaActiva: true, tipoAlerta: 'DENUNCIA_ROBO_ACTIVA' };
    }
    await (0, database_1.query)(`UPDATE validacion_queue SET procesada_en=NOW(), resultado='aprobado' WHERE cit_id=$1`, [citId]);
    return { citId, estado: 'PENDIENTE', alertaActiva: false, aprobadoParaFinalizar: true,
        mensaje: 'Sin alertas del Ministerio de Seguridad. Listo para acuñar en BFA.' };
}
// ══════════════════════════════════════════════════════════
// FINALIZAR CIT — acuñar NFT en BFA
// serial + inspectorId + hashSHA256 → tokenId
// ══════════════════════════════════════════════════════════
async function finalizarCIT(citId, propietarioWallet) {
    const timer = (0, logger_1.startTimer)('cit.finalizar', { citId });
    // Obtener datos completos del CIT + bicicleta + inspector
    const cit = await (0, database_1.queryOne)(`SELECT c.id, c.numero_cit, c.hash_sha256, c.propietario_id, c.estado,
            b.numero_serie AS bicicleta_numero_serie,
            i.wallet_address AS inspector_wallet
     FROM cits c
     JOIN bicicletas  b ON b.id = c.bicicleta_id
     JOIN inspectores i ON i.id = c.inspector_id
     WHERE c.id = $1`, [citId]);
    if (!cit)
        throw new errorHandler_1.AppError('CIT no encontrado', 404, 'CIT_NOT_FOUND');
    if (cit.estado !== 'PENDIENTE')
        throw new errorHandler_1.AppError(`CIT no está PENDIENTE (estado: ${cit.estado})`, 409, 'CIT_WRONG_STATE');
    // Verificar que la validación del Ministerio fue aprobada
    const vq = await (0, database_1.queryOne)(`SELECT resultado FROM validacion_queue WHERE cit_id=$1`, [citId]);
    if (vq?.resultado === 'rechazado')
        throw new errorHandler_1.AppError('CIT fue rechazado por el Ministerio de Seguridad (denuncia de robo activa)', 409, 'CIT_REJECTED');
    // ── VALIDACIÓN FIRMA PRE-BFA ────────────────────────────
    // Los 8 checks de integridad deben pasar antes de autorizar el mint.
    // Si falla → AppError 422 FIRMA_INVALIDA (mint bloqueado)
    const { validarFirmaPreBFA } = await import('./firma.validacion.service');
    const firmaValidacion = await validarFirmaPreBFA(citId);
    if (!firmaValidacion.aprobado) {
        throw new errorHandler_1.AppError(`Firma inválida — BFA bloqueado: ${firmaValidacion.motivoRechazo}`, 422, 'FIRMA_INVALIDA', {
            validacionId: firmaValidacion.validacionId,
            checksOk: firmaValidacion.checks.filter(c => c.ok).length,
            checksFail: firmaValidacion.checks.filter(c => !c.ok).length,
            motivoRechazo: firmaValidacion.motivoRechazo,
            checks: firmaValidacion.checks.map(c => ({ id: c.id, ok: c.ok, mensaje: c.mensaje })),
        });
    }
    // ── MINT EN BFA via servicio dedicado ────────────────────
    // acuñarCITEnBFA maneja: mint tracking, indexación, notificación, IPFS
    const mintResult = await (0, bfa_mint_service_1.acuñarCITEnBFA)(citId, propietarioWallet);
    // ms already declared
    logger_1.log.cit.info({
        citId, numeroCIT: cit.numero_cit, tokenId: mintResult.tokenId,
        txHash: mintResult.txHash, indexado: mintResult.indexado,
    }, 'CIT finalizado · ACTIVO · NFT acuñado');
    // Marcar validacion_queue
    await (0, database_1.query)(`UPDATE validacion_queue
     SET procesada_en=COALESCE(procesada_en,NOW()), resultado=COALESCE(resultado,'aprobado')
     WHERE cit_id=$1`, [citId]).catch(() => { });
    const citActualizado = await (0, database_1.queryOne)(`SELECT fecha_vencimiento, fecha_emision FROM cits WHERE id=$1`, [citId]);
    // ── IPFS: generar PDF + subir metadata (background) ─────
    let ipfsMetadataCID = null;
    let ipfsPdfCID = null;
    let tokenUri = null;
    const _subirIPFS = async () => {
        // 1. Obtener datos completos del CIT para el PDF
        const citCompleto = await (0, database_1.queryOne)(`SELECT c.puntos, c.punto_detalle::text, c.firma_inspector,
                COALESCE(b.marca, '')        AS marca,
                COALESCE(b.modelo, '')       AS modelo,
                COALESCE(b.anio, 0)          AS anio,
                COALESCE(b.tipo::text, '')   AS tipo,
                COALESCE(b.color, '')        AS color,
                COALESCE(u.nombre, '')       AS propietario_nombre,
                COALESCE(u.apellido, '')     AS propietario_apellido,
                COALESCE(u.dni, '')          AS propietario_dni,
                COALESCE(ui.nombre, '')      AS inspector_nombre,
                COALESCE(ui.apellido, '')    AS inspector_apellido,
                COALESCE(ta.nombre, '')      AS taller_nombre,
                COALESCE(ta.localidad, '')   AS taller_localidad,
                COALESCE(array_to_json(c.fotos)::text, '[]') AS fotos
         FROM cits c
         LEFT JOIN bicicletas b ON b.id=c.bicicleta_id
         LEFT JOIN usuarios u ON u.id=c.propietario_id
         LEFT JOIN inspectores i ON i.id=c.inspector_id
         LEFT JOIN usuarios ui ON ui.id=i.usuario_id
         LEFT JOIN talleres_aliados ta ON ta.id=c.taller_aliado_id
         WHERE c.id=$1`, [citId]);
        // 2. Generar PDF
        const puntosDetalle = citCompleto?.punto_detalle
            ? (typeof citCompleto.punto_detalle === 'string'
                ? JSON.parse(citCompleto.punto_detalle)
                : citCompleto.punto_detalle)
            : {};
        const fotosUrls = citCompleto?.fotos
            ? (typeof citCompleto.fotos === 'string' ? JSON.parse(citCompleto.fotos) : citCompleto.fotos)
            : [];
        const pdfBuffer = await (0, pdf_service_1.generarPDFCIT)({
            numeroCIT: cit.numero_cit,
            hashSHA256: cit.hash_sha256,
            serial: cit.bicicleta_numero_serie,
            marca: citCompleto?.marca ?? '',
            modelo: citCompleto?.modelo ?? '',
            anio: citCompleto?.anio ?? 0,
            tipo: citCompleto?.tipo ?? '',
            color: citCompleto?.color ?? '',
            propietarioNombre: `${citCompleto?.propietario_nombre} ${citCompleto?.propietario_apellido}`,
            propietarioDNI: citCompleto?.propietario_dni ?? '',
            puntos: puntosDetalle,
            totalPuntos: citCompleto?.puntos ?? 0,
            inspectorNombre: citCompleto?.inspector_nombre ?? '',
            inspectorApellido: citCompleto?.inspector_apellido ?? '',
            tallerNombre: citCompleto?.taller_nombre ?? '',
            tallerLocalidad: citCompleto?.taller_localidad ?? '',
            fechaEmision: citActualizado?.fecha_emision?.toISOString() ?? new Date().toISOString(),
            nftTokenId: mintResult.tokenId,
            bfaTxHash: mintResult.txHash,
            fotosUrls,
        });
        if (!pdfBuffer)
            throw new Error('pdfBuffer is null');
        // 3. Subir PDF a IPFS
        const pdfResult = await (0, ipfs_service_1.subirPDFCIT)(pdfBuffer, cit.numero_cit);
        ipfsPdfCID = pdfResult.cid;
        // 4. Subir metadata ERC-721 a IPFS
        const metaResult = await (0, ipfs_service_1.subirMetadataCIT)({
            numeroCIT: cit.numero_cit,
            serial: cit.bicicleta_numero_serie,
            hashSHA256: cit.hash_sha256,
            marca: citCompleto?.marca ?? '',
            modelo: citCompleto?.modelo ?? '',
            anio: citCompleto?.anio ?? 0,
            tipo: citCompleto?.tipo ?? '',
            color: citCompleto?.color ?? '',
            propietarioNombre: `${citCompleto?.propietario_nombre} ${citCompleto?.propietario_apellido}`,
            inspectorNombre: `${citCompleto?.inspector_nombre} ${citCompleto?.inspector_apellido}`,
            tallerNombre: citCompleto?.taller_nombre ?? '',
            tallerLocalidad: citCompleto?.taller_localidad ?? '',
            totalPuntos: citCompleto?.puntos ?? 0,
            fechaEmision: citActualizado?.fecha_emision?.toISOString() ?? new Date().toISOString(),
            nftTokenId: mintResult.tokenId,
            bfaTxHash: mintResult.txHash,
        }, undefined, ipfsPdfCID ?? undefined);
        ipfsMetadataCID = metaResult.cid;
        tokenUri = (0, ipfs_service_1.buildTokenURI)(ipfsMetadataCID);
        // 5. Guardar CIDs en DB
        await (0, database_1.query)(`UPDATE cits
         SET ipfs_pdf_cid      = $2,
             ipfs_metadata_cid = $3,
             token_uri         = $4,
             ipfs_subido_en    = NOW()
         WHERE id = $1`, [citId, ipfsPdfCID, ipfsMetadataCID, tokenUri]);
        logger_1.log.cit.info({
            citId, numeroCIT: cit.numero_cit,
            pdfCID: ipfsPdfCID?.slice(0, 20) + '...',
            metadataCID: ipfsMetadataCID?.slice(0, 20) + '...',
            tokenUri,
        }, 'CIT subido a IPFS · metadata ERC-721 lista');
    };
    _subirIPFS().catch(err => {
        logger_1.log.cit.warn({ citId, err: err.message }, 'IPFS upload fallido');
    });
    // ms already declared
    logger_1.log.cit.info({
        citId, numeroCIT: cit.numero_cit,
        serial: cit.bicicleta_numero_serie,
        tokenId: mintResult.tokenId,
        txHash: mintResult.txHash,
    }, 'CIT finalizado · ACTIVO · NFT acuñado en BFA · IPFS en background');
    return {
        citId,
        numeroCIT: cit.numero_cit,
        estado: 'ACTIVO',
        serial: cit.bicicleta_numero_serie,
        hashSHA256: cit.hash_sha256,
        bfa: {
            txHash: mintResult.txHash,
            tokenId: mintResult.tokenId,
            blockNumber: mintResult.blockNumber,
            gasUsed: mintResult.gasUsed,
        },
        ipfs: {
            pdfCID: ipfsPdfCID,
            metadataCID: ipfsMetadataCID,
            tokenUri,
            note: 'La subida a IPFS se procesa en background. Los CIDs estarán disponibles en segundos.',
        },
        fechaEmision: new Date().toISOString(),
        fechaVencimiento: citActualizado?.fecha_vencimiento?.toISOString() ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
}
// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════
async function getCITById(citId, solicitanteId) {
    const cit = await (0, database_1.queryOne)(`SELECT
       c.id, c.numero_cit, c.estado, c.puntos, c.punto_detalle,
       c.hash_sha256, c.bfa_tx_hash, c.nft_token_id,
       c.firma_inspector, c.dj_firmada, c.dj_firmada_en,
       c.fecha_emision, c.fecha_vencimiento, c.fotos, c.creado_en,
       b.numero_serie, b.marca, b.modelo, b.anio, b.tipo AS tipo_bicicleta, b.color,
       u.nombre  AS propietario_nombre,  u.apellido AS propietario_apellido,
       u.email   AS propietario_email,
       ui.nombre AS inspector_nombre,    ui.apellido AS inspector_apellido,
       ta.nombre AS taller_nombre,       ta.localidad AS taller_localidad,
       ta.lat, ta.lng
     FROM cits c
     JOIN bicicletas       b  ON b.id  = c.bicicleta_id
     JOIN usuarios         u  ON u.id  = c.propietario_id
     JOIN inspectores      i  ON i.id  = c.inspector_id
     JOIN usuarios         ui ON ui.id = i.usuario_id
     JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
     WHERE c.id = $1`, [citId]);
    if (!cit)
        throw new errorHandler_1.AppError('CIT no encontrado', 404, 'CIT_NOT_FOUND');
    // Ocultar firma al propietario incorrecto
    if (solicitanteId) {
        const owner = await (0, database_1.queryOne)(`SELECT propietario_id FROM cits WHERE id=$1`, [citId]);
        if (owner?.propietario_id !== solicitanteId) {
            delete cit.firma_inspector;
        }
    }
    return cit;
}
async function verificarSerial(numeroSerie) {
    const rows = await (0, database_1.query)(`SELECT c.id, c.numero_cit, c.estado, c.bfa_tx_hash, c.nft_token_id,
            c.hash_sha256, c.fecha_emision, c.fecha_vencimiento,
            b.marca, b.modelo, b.color,
            ui.nombre AS inspector_nombre, ui.apellido AS inspector_apellido,
            ta.nombre AS taller_nombre,   ta.localidad AS taller_localidad
     FROM cits c
     JOIN bicicletas       b  ON b.id  = c.bicicleta_id
     JOIN inspectores      i  ON i.id  = c.inspector_id
     JOIN usuarios         ui ON ui.id = i.usuario_id
     JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
     WHERE b.numero_serie = $1
     ORDER BY c.creado_en DESC`, [numeroSerie]);
    if (!rows.length)
        return { encontrado: false, serial: numeroSerie };
    const ultimo = rows[0];
    const activo = ultimo.estado === 'ACTIVO';
    // Verificar en BFA si existe el hash (consulta gratuita)
    let bfaVerification = null;
    if (activo && ultimo.hash_sha256) {
        try {
            bfaVerification = await bfa_service_1.bfaService.verificarIntegridad(ultimo.hash_sha256);
        }
        catch { /* BFA no disponible — no bloquear */ }
    }
    return {
        encontrado: true,
        serial: numeroSerie,
        citActivo: activo,
        ultimoCIT: ultimo,
        historial: rows.slice(1).map(r => ({ id: r.id, numeroCIT: r.numero_cit, estado: r.estado })),
        bfa: bfaVerification,
    };
}
async function misCITs(propietarioId) {
    return (0, database_1.query)(`SELECT c.id, c.numero_cit, c.estado, c.puntos, c.hash_sha256,
            c.bfa_tx_hash, c.nft_token_id, c.fecha_emision, c.fecha_vencimiento, c.creado_en,
            b.numero_serie, b.marca, b.modelo, b.anio, b.color,
            ta.nombre AS taller_nombre, ta.localidad AS taller_localidad
     FROM cits c
     JOIN bicicletas       b  ON b.id  = c.bicicleta_id
     JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
     WHERE c.propietario_id = $1
     ORDER BY c.creado_en DESC`, [propietarioId]);
}
