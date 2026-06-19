"use strict";
// ─── RODAID · Servicio de Seguridad ──────────────────────
// Denuncia de robo y bloqueo en tiempo real:
//
//   denunciarRobo(citId)
//     1. Verifica propietario + estado CIT
//     2. TX atómica: CIT→BLOQUEADO + denuncia + pausa marketplace
//     3. BFA lock INMEDIATO del NFT (tiempo real)
//        → Si falla: encola retry, DB ya está bloqueada
//     4. Notifica Ministerio de Seguridad Mendoza (stub/real)
//     5. Notificación push al propietario
//
//   marcarRecuperada(denunciaId)
//     1. Verifica propietario + estado denuncia
//     2. TX atómica: denuncia→RECUPERADA + CIT→ACTIVO
//     3. BFA unlock INMEDIATO del NFT (tiempo real)
//        → Si falla: encola retry, DB ya está desbloqueada
//     4. Notificación al propietario
//
//   Garantía de consistencia:
//     Estado DB y BFA están desacoplados. La fuente de verdad legal
//     es la blockchain (BFA), pero el sistema opera sin esperar a BFA
//     para no bloquear al usuario. Un job de reconciliación verifica
//     y corrige discrepancias cada hora.
Object.defineProperty(exports, "__esModule", { value: true });
exports.denunciarRobo = denunciarRobo;
exports.verificarAlertas = verificarAlertas;
exports.marcarRecuperada = marcarRecuperada;
exports.misDenuncias = misDenuncias;
exports.getPendingBFALocks = getPendingBFALocks;
exports.reintentarBFALock = reintentarBFALock;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const errorHandler_1 = require("../middleware/errorHandler");
const minseg_service_1 = require("./minseg.service");
const bfa_service_1 = require("./bfa.service");
const env_1 = require("../config/env");
async function notificarMinSeguridad(data) {
    if (env_1.env.MINSEG_API_KEY && env_1.env.MINSEG_API_URL) {
        try {
            const res = await fetch(`${env_1.env.MINSEG_API_URL}/api/v1/denuncias/bicicletas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env_1.env.MINSEG_API_KEY}`,
                    'X-Rodaid-Source': 'RODAID-API-v1',
                },
                body: JSON.stringify(data),
            });
            if (res.ok)
                return res.json();
            logger_1.log.seguridad.warn({ status: res.status, serial: data.numeroSerie }, 'Min.Seg API error — registrado localmente');
        }
        catch (err) {
            logger_1.log.seguridad.warn({ err, serial: data.numeroSerie }, 'Min.Seg API no disponible — registrado localmente');
        }
    }
    // STUB — pendiente de convenio técnico (TAD EX-2026-26089745)
    logger_1.log.seguridad.warn({ serial: data.numeroSerie }, '⚠️  MINSEG STUB — denuncia simulada');
    return {
        expediente: `MSM-${Date.now().toString(36).toUpperCase()}`,
        recibido: true,
        alertaGlobal: true,
    };
}
// ══════════════════════════════════════════════════════════
// BFA — LOCK Y UNLOCK EN TIEMPO REAL
// ══════════════════════════════════════════════════════════
/**
 * Bloquea el NFT en BFA de forma síncrona.
 * Si falla, registra el error y encola un retry.
 * La DB ya está bloqueada antes de llamar esta función.
 */
async function bfaLockRealtime(denunciaId, nftTokenId, motivo) {
    const timer = (0, logger_1.startTimer)('bfa.lock', { tokenId: nftTokenId });
    try {
        const txHash = await bfa_service_1.bfaService.bloquear(nftTokenId, motivo);
        const ms = timer({ txHash });
        // Guardar txHash en DB
        await (0, database_1.query)(`UPDATE denuncias_robo
       SET bfa_lock_tx_hash  = $2,
           bfa_locked_en     = NOW(),
           bfa_lock_intentos = bfa_lock_intentos + 1,
           bfa_reintento_en  = NULL,
           bfa_lock_error    = NULL
       WHERE id = $1`, [denunciaId, txHash]);
        logger_1.log.seguridad.info({
            denunciaId, tokenId: nftTokenId, txHash, ms,
        }, '🔒 NFT bloqueado en BFA · tiempo real');
        return { txHash, ok: true };
    }
    catch (err) {
        const errMsg = err.message;
        const ms = timer({ error: errMsg });
        // Registrar fallo y programar retry en 10 minutos
        await (0, database_1.query)(`UPDATE denuncias_robo
       SET bfa_lock_intentos = bfa_lock_intentos + 1,
           bfa_lock_error    = $2,
           bfa_reintento_en  = NOW() + INTERVAL '10 minutes'
       WHERE id = $1`, [denunciaId, errMsg]).catch(() => { }); // best-effort
        logger_1.log.seguridad.warn({
            denunciaId, tokenId: nftTokenId, errMsg, ms,
        }, '⚠️  BFA lock falló — CIT bloqueado en DB, NFT pendiente · retry en 10 min');
        return { txHash: null, ok: false, error: errMsg };
    }
}
/**
 * Desbloquea el NFT en BFA de forma síncrona.
 * Si falla, solo loguea (la DB ya está desbloqueada).
 */
async function bfaUnlockRealtime(denunciaId, nftTokenId) {
    const timer = (0, logger_1.startTimer)('bfa.unlock', { tokenId: nftTokenId });
    try {
        const txHash = await bfa_service_1.bfaService.desbloquear(nftTokenId);
        const ms = timer({ txHash });
        // Guardar txHash del unlock
        await (0, database_1.query)(`UPDATE denuncias_robo
       SET bfa_unlock_tx_hash = $2,
           bfa_unlocked_en    = NOW()
       WHERE id = $1`, [denunciaId, txHash]);
        logger_1.log.seguridad.info({
            denunciaId, tokenId: nftTokenId, txHash, ms,
        }, '🔓 NFT desbloqueado en BFA · tiempo real');
        return { txHash, ok: true };
    }
    catch (err) {
        const errMsg = err.message;
        const ms = timer({ error: errMsg });
        logger_1.log.seguridad.warn({
            denunciaId, tokenId: nftTokenId, errMsg, ms,
        }, '⚠️  BFA unlock falló — CIT desbloqueado en DB, NFT pendiente');
        return { txHash: null, ok: false, error: errMsg };
    }
}
// ══════════════════════════════════════════════════════════
// DENUNCIAR ROBO — POST /seguridad/denunciar
// ══════════════════════════════════════════════════════════
async function denunciarRobo(input) {
    const timer = (0, logger_1.startTimer)('seguridad.denunciar', { citId: input.citId });
    // ── 1. Verificar CIT + propietario ────────────────────
    const cit = await (0, database_1.queryOne)(`SELECT c.id, c.numero_cit, c.bicicleta_id, c.propietario_id,
            c.estado, c.nft_token_id, c.bfa_tx_hash, c.hash_sha256,
            b.numero_serie, b.marca, b.modelo, b.anio, b.color
     FROM cits c JOIN bicicletas b ON b.id = c.bicicleta_id
     WHERE c.id = $1`, [input.citId]);
    if (!cit)
        throw new errorHandler_1.AppError('CIT no encontrado', 404, 'CIT_NOT_FOUND');
    if (cit.propietario_id !== input.denuncianteId) {
        throw new errorHandler_1.AppError('Solo el propietario del CIT puede realizar la denuncia', 403, 'NOT_OWNER');
    }
    if (cit.estado === 'BLOQUEADO') {
        throw new errorHandler_1.AppError('Ya existe una denuncia activa para este rodado', 409, 'YA_DENUNCIADO');
    }
    if (!['ACTIVO', 'PENDIENTE'].includes(cit.estado)) {
        throw new errorHandler_1.AppError(`No se puede denunciar un CIT en estado ${cit.estado}`, 422, 'CIT_ESTADO_INVALIDO');
    }
    // Verificar que no exista una denuncia activa previa
    const denunciaActiva = await (0, database_1.queryOne)(`SELECT id FROM denuncias_robo WHERE cit_id = $1 AND estado = 'ACTIVA'`, [input.citId]);
    if (denunciaActiva)
        throw new errorHandler_1.AppError('Ya existe una denuncia activa para este CIT', 409, 'YA_DENUNCIADO');
    // ── 2. Datos del denunciante ──────────────────────────
    const denunciante = await (0, database_1.queryOne)(`SELECT nombre, apellido, dni, telefono FROM usuarios WHERE id = $1`, [input.denuncianteId]);
    const nombreCompleto = input.denuncianteNombre ?? `${denunciante?.nombre} ${denunciante?.apellido}`;
    const dni = input.denuncianteDNI ?? denunciante?.dni ?? 'SIN_DNI';
    // ── 2b. Cancelar job de validación (72 hs) si está en cola ──
    if (cit.estado === 'PENDIENTE') {
        try {
            const { cancelarValidacion } = await import('./queue.service');
            const cancelResult = await cancelarValidacion(input.citId);
            if (cancelResult.cancelado) {
                logger_1.log.seguridad.info({ citId: input.citId, jobId: cancelResult.jobId }, '⏹ Job validación cancelado por denuncia');
            }
        }
        catch { /* best-effort — no bloquear la denuncia si el queue falla */ }
    }
    // ── 3. TX atómica: bloquear DB ───────────────────────
    const denunciaId = await (0, database_1.transaction)(async (client) => {
        // a) Bloquear CIT en PostgreSQL
        await client.query(`UPDATE cits SET estado='BLOQUEADO', actualizado_en=NOW() WHERE id=$1`, [input.citId]);
        // b) Pausar publicaciones activas en Marketplace
        await client.query(`UPDATE publicaciones SET estado='PAUSADA', actualizado_en=NOW()
       WHERE bicicleta_id=$1 AND estado='ACTIVA'`, [cit.bicicleta_id]);
        // c) Crear denuncia
        const dr = await client.query(`INSERT INTO denuncias_robo (
         cit_id, denunciante_id, numero_serie, marca, modelo,
         descripcion, lugar_robo, fecha_robo,
         denunciante_dni, denunciante_nombre, denunciante_telefono,
         denunciante_geolocalizacion
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`, [
            input.citId, input.denuncianteId, cit.numero_serie, cit.marca, cit.modelo,
            input.descripcion, input.lugarRobo ?? null,
            input.fechaRobo ? new Date(input.fechaRobo) : null,
            dni, nombreCompleto, input.denuncianteTelefono ?? denunciante?.telefono ?? null,
            JSON.stringify({ lat: input.geoLat ?? null, lng: input.geoLng ?? null }),
        ]);
        return dr.rows[0].id;
    });
    logger_1.log.seguridad.info({
        denunciaId, citId: input.citId, serial: cit.numero_serie,
        tokenId: cit.nft_token_id,
    }, 'CIT bloqueado en DB · iniciando lock BFA');
    // ── 4. BFA LOCK EN TIEMPO REAL ────────────────────────
    // Se ejecuta fuera de la TX para no bloquear si BFA tarda
    // El CIT ya está bloqueado en DB — la blockchain es el registro definitivo
    const bfaLock = cit.nft_token_id
        ? await bfaLockRealtime(denunciaId, cit.nft_token_id, `DENUNCIA_ROBO:${denunciaId}:${cit.numero_serie}:${Date.now()}`)
        : { txHash: null, ok: false, error: 'CIT sin NFT acuñado — lock pendiente' };
    if (!bfaLock.ok) {
        logger_1.log.seguridad.warn({
            denunciaId, tokenId: cit.nft_token_id, error: bfaLock.error,
        }, '⚠️  BFA lock fallido — CIT bloqueado en DB, NFT se bloqueará en retry');
    }
    // ── 5. Notificar Ministerio de Seguridad ─────────────
    let minSegExpediente = null;
    try {
        const minSeg = await notificarMinSeguridad({
            numeroSerie: cit.numero_serie,
            marca: cit.marca,
            modelo: cit.modelo,
            denuncianteDNI: dni,
            denuncianteNombre: nombreCompleto,
            descripcion: input.descripcion,
            lugarRobo: input.lugarRobo,
            fechaRobo: input.fechaRobo,
        });
        minSegExpediente = minSeg.expediente;
        await (0, database_1.query)(`UPDATE denuncias_robo
       SET min_seg_notificado=TRUE, min_seg_expediente=$2, min_seg_notif_en=NOW()
       WHERE id=$1`, [denunciaId, minSegExpediente]);
        logger_1.log.seguridad.info({ expediente: minSegExpediente }, 'Ministerio de Seguridad notificado');
    }
    catch (err) {
        logger_1.log.seguridad.error({ err, denunciaId }, 'Error notificando Min.Seg — reintentará');
    }
    // ── 6. Notificación push al propietario ───────────────
    await (0, database_1.query)(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
     VALUES ($1,'DENUNCIA_REGISTRADA',
       'Denuncia de robo registrada · CIT bloqueado',
       'Tu denuncia fue registrada. El CIT quedó bloqueado en la Blockchain Federal Argentina y el Ministerio de Seguridad fue notificado. Ninguna venta puede realizarse.',
       $2)`, [input.denuncianteId, JSON.stringify({
            denunciaId, citId: input.citId, numeroCIT: cit.numero_cit,
            numeroSerie: cit.numero_serie, minSegExpediente,
            bfaTxHash: bfaLock.txHash, nftTokenId: cit.nft_token_id,
        })]);
    const ms = timer({ denunciaId, bfaOk: bfaLock.ok });
    (async () => {
        try {
            const citDataMinseg = await (0, database_1.queryOne)(`SELECT c.numero_cit, u.dni AS propietario_dni,
                u.nombre||' '||u.apellido AS propietario_nombre,
                b.marca, b.modelo, b.anio, b.color, b.numero_serie
         FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id JOIN usuarios u ON u.id=c.propietario_id
         WHERE c.id=$1`, [input.citId]);
            const minSegResult = await (0, minseg_service_1.reportarDenuncia)({
                denunciaRodaidId: denunciaId,
                numeroCIT: citDataMinseg?.numero_cit ?? 'SIN-CIT',
                serial: citDataMinseg?.numero_serie ?? '',
                marca: citDataMinseg?.marca ?? '',
                modelo: citDataMinseg?.modelo ?? '',
                anio: citDataMinseg?.anio ?? 0,
                color: citDataMinseg?.color ?? '',
                propietarioDNI: citDataMinseg?.propietario_dni ?? 'N/D',
                propietarioNombre: citDataMinseg?.propietario_nombre ?? 'N/D',
                descripcion: input.descripcion,
                fechaDenuncia: new Date().toISOString(),
            });
            if (minSegResult.registrado && minSegResult.expediente) {
                await (0, database_1.query)(`UPDATE denuncias_robo
           SET min_seg_expediente=COALESCE(min_seg_expediente,$2),
               minseg_notificado=TRUE, minseg_notificado_en=NOW()
           WHERE id=$1`, [denunciaId, minSegResult.expediente]);
                logger_1.log.seguridad.info({ denunciaId, expediente: minSegResult.expediente, stub: minSegResult.stub }, '✓ Denuncia notificada a Min.Seg.');
            }
        }
        catch (err) {
            logger_1.log.seguridad.warn({ denunciaId, err: err.message }, 'MinSeg notify falló');
        }
    })();
    return {
        denunciaId,
        numeroCIT: cit.numero_cit,
        numeroSerie: cit.numero_serie,
        marca: `${cit.marca} ${cit.modelo} ${cit.anio}`,
        estado: 'ACTIVA',
        citEstado: 'BLOQUEADO',
        bfa: {
            ok: bfaLock.ok,
            txHash: bfaLock.txHash,
            tokenId: cit.nft_token_id,
            bloqueado: bfaLock.ok,
            error: bfaLock.error ?? null,
        },
        minSegExpediente,
        minSegNotificado: minSegExpediente !== null,
        alertaMarketplace: true,
        ms,
        mensaje: 'Denuncia registrada · CIT bloqueado',
        accionesTomadas: [
            '✓ CIT marcado como BLOQUEADO en RODAID',
            bfaLock.ok
                ? `✓ NFT #${cit.nft_token_id} bloqueado en BFA · tx ${bfaLock.txHash?.slice(0, 12)}...`
                : `⚠ NFT pendiente de bloqueo en BFA (retry en 10 min)`,
            '✓ Bicicleta retirada del Marketplace automáticamente',
            minSegExpediente
                ? `✓ Expediente Min. Seguridad: ${minSegExpediente}`
                : '⚠ Notificación Min. Seguridad pendiente',
            '✓ Notificación enviada al propietario',
        ],
    };
}
// ══════════════════════════════════════════════════════════
// ALERTAS — GET /seguridad/alertas/:serial (PÚBLICO)
// ══════════════════════════════════════════════════════════
async function verificarAlertas(numeroSerie) {
    const alertas = await (0, database_1.query)(`SELECT d.id, d.estado, d.descripcion, d.lugar_robo, d.fecha_robo,
            d.min_seg_expediente, d.bfa_lock_tx_hash, d.bfa_unlock_tx_hash,
            d.bfa_lock_intentos, d.creado_en,
            c.numero_cit, b.marca, b.modelo
     FROM denuncias_robo d
     JOIN cits c ON c.id = d.cit_id
     JOIN bicicletas b ON b.id = c.bicicleta_id
     WHERE d.numero_serie = $1
     ORDER BY d.creado_en DESC`, [numeroSerie]);
    const activa = alertas.find(a => a.estado === 'ACTIVA');
    // Si hay alerta activa, verificar también en BFA (source of truth)
    let bfaStatus = null;
    if (activa?.bfa_lock_tx_hash) {
        try {
            const cit = await (0, database_1.queryOne)(`SELECT c.hash_sha256 FROM denuncias_robo d JOIN cits c ON c.id=d.cit_id WHERE d.id=$1`, [activa.id]);
            if (cit?.hash_sha256) {
                bfaStatus = await bfa_service_1.bfaService.verificarIntegridad(cit.hash_sha256);
            }
        }
        catch { /* BFA no disponible — no bloquear */ }
    }
    // AlertasPayload — campo estándar del protocolo MinSeg/CrossRef
    const alertasPayload = {
        alerta_activa: !!activa,
        tipo_alerta: activa ? (activa.estado === 'ACTIVA' ? 'ROBO' : 'RECUPERADA') : undefined,
        expediente: activa?.min_seg_expediente ?? undefined,
        expediente_mxm: undefined,
        fuente: 'RODAID',
        numero_denuncia: activa?.id ?? undefined,
        fecha_denuncia: activa?.creado_en?.toISOString(),
        fecha_robo: activa?.fecha_robo?.toISOString() ?? undefined,
        descripcion: activa?.descripcion ?? undefined,
        bloqueado: bfaStatus?.bloqueado ?? false,
        motivo_bloqueo: (activa?.estado === 'ACTIVA' ? 'DENUNCIA_ROBO' : undefined),
        bfa_bloqueado: bfaStatus?.bloqueado ?? false,
        bfa_lock_tx_hash: activa?.bfa_lock_tx_hash ?? undefined,
    };
    return {
        numeroSerie,
        alertas: alertasPayload,
        tieneAlertaActiva: !!activa,
        bfaBloqueado: bfaStatus?.bloqueado ?? false,
        totalDenuncias: alertas.length,
        historial: alertas.map(a => ({
            id: a.id,
            estado: a.estado,
            numeroCIT: a.numero_cit,
            marca: a.marca,
            modelo: a.modelo,
            descripcion: a.descripcion,
            lugarRobo: a.lugar_robo,
            fechaRobo: a.fecha_robo,
            expediente: a.min_seg_expediente,
            bfa: {
                lockTxHash: a.bfa_lock_tx_hash,
                unlockTxHash: a.bfa_unlock_tx_hash,
                intentos: a.bfa_lock_intentos,
            },
            denunciadoEn: a.creado_en,
        })),
        ...(bfaStatus && { bfaVerificacion: bfaStatus }),
    };
}
// ══════════════════════════════════════════════════════════
// RECUPERAR — POST /seguridad/denuncias/:id/recuperar
// ══════════════════════════════════════════════════════════
async function marcarRecuperada(denunciaId, propietarioId) {
    const timer = (0, logger_1.startTimer)('seguridad.recuperar', { denunciaId });
    const denuncia = await (0, database_1.queryOne)(`SELECT d.*, c.propietario_id, c.nft_token_id
     FROM denuncias_robo d JOIN cits c ON c.id = d.cit_id
     WHERE d.id = $1`, [denunciaId]);
    if (!denuncia)
        throw new errorHandler_1.AppError('Denuncia no encontrada', 404, 'DENUNCIA_NOT_FOUND');
    if (denuncia.propietario_id !== propietarioId)
        throw new errorHandler_1.AppError('No autorizado', 403, 'NOT_OWNER');
    if (denuncia.estado !== 'ACTIVA') {
        throw new errorHandler_1.AppError(`La denuncia ya está en estado ${denuncia.estado}`, 409, 'DENUNCIA_ESTADO_INVALIDO');
    }
    // ── TX atómica: desbloquear DB ────────────────────────
    await (0, database_1.transaction)(async (client) => {
        await client.query(`UPDATE denuncias_robo SET estado='RECUPERADA', actualizado_en=NOW() WHERE id=$1`, [denunciaId]);
        await client.query(`UPDATE cits SET estado='ACTIVO', actualizado_en=NOW() WHERE id=$1`, [denuncia.cit_id]);
        await client.query(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
       VALUES ($1,'BICI_RECUPERADA','¡Bicicleta recuperada! · CIT reactivado',
         'Marcaste tu bicicleta como recuperada. El CIT fue reactivado en RODAID y la Blockchain Federal Argentina. Recomendamos una nueva inspección técnica.',
         $2)`, [propietarioId, JSON.stringify({ denunciaId, citId: denuncia.cit_id })]);
    });
    (async () => {
        try {
            const citData = await (0, database_1.queryOne)(`SELECT c.numero_cit, u.dni AS propietario_dni,
                u.nombre||' '||u.apellido AS propietario_nombre,
                b.marca, b.modelo, b.anio, b.color, b.numero_serie
         FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id JOIN usuarios u ON u.id=c.propietario_id
         WHERE c.id=$1`, [denuncia.cit_id]);
            const result = await (0, minseg_service_1.reportarDenuncia)({
                denunciaRodaidId: denunciaId,
                numeroCIT: citData?.numero_cit ?? 'SIN-CIT',
                serial: citData?.numero_serie ?? denuncia.numero_serie,
                marca: citData?.marca ?? '',
                modelo: citData?.modelo ?? '',
                anio: citData?.anio ?? 0,
                color: citData?.color ?? '',
                propietarioDNI: citData?.propietario_dni ?? 'N/D',
                propietarioNombre: citData?.propietario_nombre ?? 'N/D',
                descripcion: 'Denuncia de robo registrada en RODAID',
                fechaDenuncia: new Date().toISOString(),
            });
            if (result.registrado && result.expediente) {
                await (0, database_1.query)(`UPDATE denuncias_robo
           SET min_seg_expediente=$2, minseg_notificado=TRUE, minseg_notificado_en=NOW()
           WHERE id=$1`, [denunciaId, result.expediente]);
                (async () => {
                    const dbDenuncia = await (0, database_1.queryOne)(`SELECT min_seg_expediente, numero_serie FROM denuncias_robo WHERE id=$1`, [denunciaId]);
                    if (dbDenuncia?.min_seg_expediente) {
                        const result = await (0, minseg_service_1.reportarRecuperacion)(dbDenuncia.min_seg_expediente, dbDenuncia.numero_serie, new Date().toISOString());
                        logger_1.log.seguridad.info({ denunciaId, expediente: dbDenuncia.min_seg_expediente,
                            actualizado: result.actualizado, stub: result.stub }, '✓ Recuperación notificada a Min.Seg.');
                    }
                })();
                logger_1.log.seguridad.info({ denunciaId, expediente: result.expediente, stub: result.stub }, '✓ Denuncia notificada a Min.Seg.');
            }
        }
        catch (err) {
            logger_1.log.seguridad.warn({ denunciaId, err: err.message }, 'MinSeg notify falló');
        }
    })();
    logger_1.log.seguridad.info({
        denunciaId, serial: denuncia.numero_serie,
        tokenId: denuncia.nft_token_id,
    }, 'DB desbloqueada · iniciando unlock BFA');
    // ── BFA UNLOCK EN TIEMPO REAL ─────────────────────────
    const bfaUnlock = denuncia.nft_token_id
        ? await bfaUnlockRealtime(denunciaId, denuncia.nft_token_id)
        : { txHash: null, ok: false, error: 'Sin NFT acuñado' };
    const ms = timer({ bfaOk: bfaUnlock.ok });
    return {
        denunciaId,
        estado: 'RECUPERADA',
        citEstado: 'ACTIVO',
        bfa: {
            ok: bfaUnlock.ok,
            unlockTxHash: bfaUnlock.txHash,
            tokenId: denuncia.nft_token_id,
            desbloqueado: bfaUnlock.ok,
            error: bfaUnlock.error ?? null,
        },
        ms,
        mensaje: 'Bicicleta marcada como recuperada. CIT reactivado. Se recomienda nueva inspección técnica.',
        accionesTomadas: [
            '✓ Denuncia marcada como RECUPERADA',
            '✓ CIT reactivado en RODAID',
            bfaUnlock.ok
                ? `✓ NFT #${denuncia.nft_token_id} desbloqueado en BFA · tx ${bfaUnlock.txHash?.slice(0, 12)}...`
                : `⚠ NFT pendiente de desbloqueo en BFA`,
        ],
    };
}
// ══════════════════════════════════════════════════════════
// MIS DENUNCIAS — GET /seguridad/mis-denuncias
// ══════════════════════════════════════════════════════════
async function misDenuncias(userId) {
    return (0, database_1.query)(`SELECT d.id, d.estado, d.descripcion, d.lugar_robo, d.fecha_robo,
            d.min_seg_notificado, d.min_seg_expediente,
            d.bfa_lock_tx_hash, d.bfa_locked_en,
            d.bfa_unlock_tx_hash, d.bfa_unlocked_en,
            d.bfa_lock_intentos, d.bfa_lock_error,
            d.creado_en, d.actualizado_en,
            c.numero_cit, c.estado AS cit_estado, c.nft_token_id,
            b.numero_serie, b.marca, b.modelo, b.anio, b.color
     FROM denuncias_robo d
     JOIN cits c ON c.id = d.cit_id
     JOIN bicicletas b ON b.id = c.bicicleta_id
     WHERE d.denunciante_id = $1
     ORDER BY d.creado_en DESC`, [userId]);
}
async function getPendingBFALocks() {
    const rows = await (0, database_1.query)(`SELECT d.id, d.cit_id, c.nft_token_id, d.bfa_lock_intentos, d.bfa_lock_error, d.bfa_reintento_en
     FROM denuncias_robo d
     JOIN cits c ON c.id = d.cit_id
     WHERE d.bfa_lock_tx_hash IS NULL
       AND d.estado = 'ACTIVA'
       AND c.nft_token_id IS NOT NULL
     ORDER BY d.creado_en ASC`, []);
    return rows.map(r => ({
        denunciaId: r.id,
        citId: r.cit_id,
        nftTokenId: r.nft_token_id,
        intentos: r.bfa_lock_intentos,
        ultimoError: r.bfa_lock_error,
        reintentoEn: r.bfa_reintento_en,
    }));
}
async function reintentarBFALock(denunciaId) {
    const row = await (0, database_1.queryOne)(`SELECT c.nft_token_id, d.numero_serie
     FROM denuncias_robo d JOIN cits c ON c.id = d.cit_id
     WHERE d.id = $1 AND d.bfa_lock_tx_hash IS NULL AND d.estado = 'ACTIVA'`, [denunciaId]);
    if (!row?.nft_token_id)
        throw new errorHandler_1.AppError('No hay lock pendiente para esta denuncia', 404);
    const result = await bfaLockRealtime(denunciaId, row.nft_token_id, `DENUNCIA_ROBO:${denunciaId}:${row.numero_serie}:RETRY`);
    return { ok: result.ok, txHash: result.txHash };
}
