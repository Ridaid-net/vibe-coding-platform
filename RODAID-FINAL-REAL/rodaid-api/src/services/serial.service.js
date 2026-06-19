"use strict";
// ─── RODAID · Servicio de Validación de Serial ───────────
// Valida el número de serie de la bicicleta contra múltiples
// fuentes ANTES de iniciar el CIT (Ley 9556, Art. 10).
//
// Checks ejecutados en orden de severidad:
//   1. Formato del serial         (regex configurable por tipo)
//   2. Existencia en DB           (la bici debe estar registrada en RODAID)
//   3. Propiedad del presentante  (el DNI/usuario debe coincidir)
//   4. Denuncias de robo activas  (tabla denuncias_robo)
//   5. CIT bloqueado en BFA       (índice de eventos on-chain)
//   6. Ministerio de Seguridad    (API externa — stub hasta convenio)
//   7. Duplicado CIT activo       (ya tiene inspección vigente)
//
// Resultado: APROBADO | ALERTA (advertencia) | RECHAZADO (bloqueante)
// Cada check es independiente — se ejecutan en paralelo salvo dependencias.
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarSerial = validarSerial;
exports.vincularValidacionACIT = vincularValidacionACIT;
const database_1 = require("../config/database");
const minseg_service_1 = require("./minseg.service");
const logger_1 = require("../middleware/logger");
const bfa_indexer_1 = require("./bfa.indexer");
// ══════════════════════════════════════════════════════════
// CHECKS INDIVIDUALES
// ══════════════════════════════════════════════════════════
/**
 * 1. Formato del serial: mínimo 5 chars, sin caracteres peligrosos.
 *    Futura extensión: regex por fabricante (Trek SN-XXXXX, Giant NXX, etc.)
 */
function checkFormatoSerial(serial) {
    const min = 5;
    const max = 60;
    const ok = serial.length >= min && serial.length <= max && /^[A-Za-z0-9\-_.]+$/.test(serial);
    return {
        nombre: 'formato_serial',
        resultado: ok ? 'OK' : 'BLOQUEANTE',
        mensaje: ok
            ? `Serial con formato válido (${serial.length} chars)`
            : `Serial inválido: debe tener ${min}-${max} chars alfanuméricos (sin espacios ni caracteres especiales)`,
        detalle: { longitud: serial.length, min, max },
    };
}
/**
 * 2. Existencia en DB: la bicicleta debe estar registrada.
 *    Retorna el bicicletaId y propietario_id para los siguientes checks.
 */
async function checkExistenciaDB(serial) {
    const bici = await (0, database_1.queryOne)(`SELECT id, propietario_id, marca, modelo, anio
     FROM bicicletas WHERE numero_serie = $1`, [serial]);
    return {
        check: {
            nombre: 'existencia_db',
            resultado: bici ? 'OK' : 'BLOQUEANTE',
            mensaje: bici
                ? `Bicicleta registrada: ${bici.marca} ${bici.modelo} ${bici.anio}`
                : `Número de serie no registrado en RODAID. El propietario debe registrar la bicicleta primero.`,
            detalle: bici ? { bicicletaId: bici.id, marca: bici.marca, modelo: bici.modelo } : undefined,
        },
        bicicletaId: bici?.id ?? null,
        propietarioId: bici?.propietario_id ?? null,
        marca: bici?.marca ?? null,
        modelo: bici?.modelo ?? null,
        anio: bici?.anio ?? null,
    };
}
/**
 * 3. Propiedad: verifica que quien presenta el CIT sea el propietario registrado.
 *    El DNI del formulario debe coincidir con el DNI del propietario en DB.
 */
async function checkPropiedad(propietarioId, propietarioDNI, propietarioNombre) {
    if (!propietarioId) {
        return { nombre: 'propiedad', resultado: 'BLOQUEANTE', mensaje: 'Bicicleta sin propietario registrado' };
    }
    const usuario = await (0, database_1.queryOne)(`SELECT dni, nombre, apellido FROM usuarios WHERE id = $1`, [propietarioId]);
    if (!usuario?.dni) {
        return {
            nombre: 'propiedad',
            resultado: 'ALERTA',
            mensaje: `Propietario sin DNI registrado en RODAID (${usuario?.nombre ?? 'desconocido'}). Verificar identidad manualmente.`,
        };
    }
    const dniMatch = usuario.dni.replace(/\D/g, '') === propietarioDNI.replace(/\D/g, '');
    if (!dniMatch) {
        return {
            nombre: 'propiedad',
            resultado: 'BLOQUEANTE',
            mensaje: `DNI del formulario (${propietarioDNI}) no coincide con el propietario registrado. Verificar identidad.`,
            detalle: { dniForms: propietarioDNI, dnisMatch: false },
        };
    }
    return {
        nombre: 'propiedad',
        resultado: 'OK',
        mensaje: `Propietario verificado: ${usuario.nombre} ${usuario.apellido} · DNI ${propietarioDNI}`,
        detalle: { propietarioNombre: `${usuario.nombre} ${usuario.apellido}` },
    };
}
/**
 * 4. Denuncias de robo activas en RODAID (fuente interna).
 */
async function checkDenunciasLocales(serial) {
    const denuncias = await (0, database_1.query)(`SELECT d.id, d.estado, d.creado_en, d.min_seg_expediente
     FROM denuncias_robo d
     WHERE d.numero_serie = $1 AND d.estado = 'ACTIVA'
     ORDER BY d.creado_en DESC`, [serial]);
    if (!denuncias.length) {
        return { nombre: 'denuncias_locales', resultado: 'OK', mensaje: 'Sin denuncias de robo activas en RODAID' };
    }
    const primera = denuncias[0];
    return {
        nombre: 'denuncias_locales',
        resultado: 'BLOQUEANTE',
        mensaje: `ALERTA: esta bicicleta tiene ${denuncias.length} denuncia(s) de robo activa(s) en RODAID. No se puede emitir el CIT.`,
        detalle: {
            totalDenunciasActivas: denuncias.length,
            primeraDenuncia: primera.creado_en.toISOString(),
            expedienteMinSeg: primera.min_seg_expediente ?? 'no notificado',
        },
    };
}
/**
 * 5. Estado BFA: verifica si el NFT del CIT está bloqueado en la blockchain.
 *    Usa el índice local (bfa_eventos), no el nodo BFA directamente.
 */
async function checkEstadoBFA(serial) {
    try {
        const bfaData = await (0, bfa_indexer_1.verificarPorSerial)(serial);
        if (!bfaData.encontrado) {
            return { nombre: 'estado_bfa', resultado: 'OK', mensaje: 'Sin registro previo en BFA — primera certificación' };
        }
        if (bfaData.bfa.bloqueado) {
            return {
                nombre: 'estado_bfa',
                resultado: 'BLOQUEANTE',
                mensaje: `NFT bloqueado en BFA (tokenId #${bfaData.bfa.tokenId}). Hay denuncia de robo activa en la blockchain.`,
                detalle: {
                    tokenId: bfaData.bfa.tokenId,
                    mintTxHash: bfaData.bfa.mintTxHash,
                    bloqueado: true,
                    bloqueoMotivo: bfaData.bfa.bloqueoMotivo,
                },
            };
        }
        return {
            nombre: 'estado_bfa',
            resultado: 'OK',
            mensaje: `Bicicleta con ${bfaData.historial.length} CIT(s) previo(s) en BFA · estado ${bfaData.estado}`,
            detalle: {
                tokenId: bfaData.bfa.tokenId,
                estado: bfaData.estado,
                transferencias: bfaData.bfa.transferencias,
            },
        };
    }
    catch (err) {
        // BFA indexer no disponible — no bloquear, solo advertir
        return {
            nombre: 'estado_bfa',
            resultado: 'ALERTA',
            mensaje: 'BFA indexer no disponible — verificación on-chain omitida. Continuar si las otras validaciones pasan.',
        };
    }
}
/**
 * 6. Ministerio de Seguridad Mendoza — vía minseg.service.ts
 *    Circuit breaker + retry + log de auditoría automático
 */
async function checkMinisterioSeguridad(serial) {
    const result = await (0, minseg_service_1.consultarSerial)(serial);
    if (result.stub) {
        return {
            nombre: 'min_seg',
            resultado: 'ALERTA',
            mensaje: 'API del Ministerio de Seguridad no configurada (convenio técnico pendiente · TAD EX-2026-26089745). Verificación manual requerida.',
        };
    }
    if (result.fuente === 'ERROR') {
        return {
            nombre: 'min_seg',
            resultado: 'ALERTA',
            mensaje: `Ministerio de Seguridad no disponible (circuit breaker o timeout). Verificar manualmente. Detalle: ${result.descripcion ?? 'N/D'}`,
        };
    }
    if (result.alerta) {
        return {
            nombre: 'min_seg',
            resultado: 'BLOQUEANTE',
            mensaje: [
                `⚠️  ALERTA Ministerio de Seguridad: serial figura como robado.`,
                `Tipo: ${result.tipo ?? 'N/D'}`,
                `Expediente: ${result.expediente ?? 'N/D'}`,
                result.fechaDenuncia ? `Fecha denuncia: ${new Date(result.fechaDenuncia).toLocaleDateString('es-AR')}` : '',
                result.descripcion ?? '',
            ].filter(Boolean).join(' · '),
            detalle: {
                tipo: result.tipo,
                expediente: result.expediente,
                fechaDenuncia: result.fechaDenuncia,
                fuente: result.fuente,
            },
        };
    }
    return {
        nombre: 'min_seg',
        resultado: 'OK',
        mensaje: `Sin alertas del Ministerio de Seguridad Mendoza (fuente: ${result.fuente})`,
    };
}
/**
 * 7. CIT activo duplicado: ya existe un certificado vigente para este serial.
 */
async function checkCITDuplicado(bicicletaId) {
    if (!bicicletaId) {
        return { nombre: 'cit_duplicado', resultado: 'OK', mensaje: 'Sin bicicleta registrada — sin duplicado' };
    }
    const activo = await (0, database_1.queryOne)(`SELECT id, numero_cit, estado, fecha_vencimiento
     FROM cits
     WHERE bicicleta_id = $1 AND estado IN ('ACTIVO', 'PENDIENTE')
     ORDER BY creado_en DESC LIMIT 1`, [bicicletaId]);
    if (!activo) {
        return { nombre: 'cit_duplicado', resultado: 'OK', mensaje: 'Sin CIT activo o pendiente para esta bicicleta' };
    }
    const vence = activo.fecha_vencimiento
        ? `· vence ${new Date(activo.fecha_vencimiento).toLocaleDateString('es-AR')}`
        : '';
    return {
        nombre: 'cit_duplicado',
        resultado: 'BLOQUEANTE',
        mensaje: `Ya existe el CIT ${activo.numero_cit} en estado ${activo.estado} ${vence}. No se puede emitir un nuevo CIT hasta que el actual venza o sea anulado.`,
        detalle: { citId: activo.id, numeroCIT: activo.numero_cit, estado: activo.estado },
    };
}
// ══════════════════════════════════════════════════════════
// ORQUESTADOR PRINCIPAL
// ══════════════════════════════════════════════════════════
async function validarSerial(input) {
    const serial = input.serial.trim().toUpperCase();
    // Check 1: formato — síncrono, rápido
    const chkFormato = checkFormatoSerial(serial);
    if (chkFormato.resultado === 'BLOQUEANTE') {
        await persistirValidacion(serial, null, null, 'RECHAZADO', [chkFormato]);
        return buildResult(serial, null, [chkFormato]);
    }
    // Check 2: existencia — necesitamos bicicletaId para los demás
    const { check: chkDB, bicicletaId, propietarioId } = await checkExistenciaDB(serial);
    if (chkDB.resultado === 'BLOQUEANTE') {
        await persistirValidacion(serial, null, null, 'RECHAZADO', [chkFormato, chkDB]);
        return buildResult(serial, null, [chkFormato, chkDB]);
    }
    // Checks 3-7 en paralelo (no tienen dependencias entre sí)
    const [chkProp, chkDenuncias, chkBFA, chkMinSeg, chkDuplicado] = await Promise.all([
        checkPropiedad(propietarioId, input.propietarioDNI, input.propietarioNombre),
        checkDenunciasLocales(serial),
        checkEstadoBFA(serial),
        checkMinisterioSeguridad(serial),
        checkCITDuplicado(bicicletaId),
    ]);
    const todos = [chkFormato, chkDB, chkProp, chkDenuncias, chkBFA, chkMinSeg, chkDuplicado];
    const result = buildResult(serial, bicicletaId, todos);
    await persistirValidacion(serial, bicicletaId, null, result.aprobado ? (result.tieneAlertas ? 'ALERTA' : 'APROBADO') : 'RECHAZADO', todos);
    return result;
}
// ── Constructor del resultado ──────────────────────────────
function buildResult(serial, bicicletaId, checks) {
    const bloqueantes = checks.filter(c => c.resultado === 'BLOQUEANTE');
    const alertas = checks.filter(c => c.resultado === 'ALERTA');
    const aprobado = bloqueantes.length === 0;
    let resumen;
    if (!aprobado) {
        resumen = `Validación RECHAZADA — ${bloqueantes.length} check(s) bloqueante(s): ${bloqueantes.map(c => c.nombre).join(', ')}`;
    }
    else if (alertas.length > 0) {
        resumen = `Validación APROBADA CON ALERTAS — ${alertas.length} advertencia(s): ${alertas.map(c => c.nombre).join(', ')}`;
    }
    else {
        resumen = `Validación APROBADA — ${checks.length} checks OK`;
    }
    return { serial, bicicletaId, aprobado, tieneAlertas: alertas.length > 0, checks, resumen };
}
// ── Persistencia del resultado ─────────────────────────────
async function persistirValidacion(serial, bicicletaId, citId, resultado, checks) {
    try {
        await (0, database_1.query)(`INSERT INTO serial_validaciones (numero_serie, bicicleta_id, cit_id, resultado, checks)
       VALUES ($1, $2, $3, $4, $5)`, [serial, bicicletaId, citId, resultado, JSON.stringify(checks)]);
    }
    catch (err) {
        logger_1.log.bfa.warn({ err: err.message }, 'serial_validaciones insert error');
    }
}
// ── Actualizar validación con citId después del CIT creado ─
async function vincularValidacionACIT(serial, citId) {
    await (0, database_1.query)(`UPDATE serial_validaciones
     SET cit_id = $2
     WHERE numero_serie = $1 AND cit_id IS NULL
     ORDER BY validado_en DESC
     LIMIT 1`, [serial, citId]).catch(() => { });
}
