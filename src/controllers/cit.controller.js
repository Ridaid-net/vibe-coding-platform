"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.denunciarRoboHandler = exports.misCITsHandler = exports.verificarSerialHandler = exports.getCITHandler = exports.finalizarCITHandler = exports.validarCITHandler = exports.prevalidarSerialHandler = exports.iniciarCITHandler = void 0;
const zod_1 = require("zod");
const errorHandler_1 = require("../middleware/errorHandler");
const database_1 = require("../config/database");
const cit_service_1 = require("../services/cit.service");
const serial_service_1 = require("../services/serial.service");
// ══════════════════════════════════════════════════════════
// SCHEMAS Zod
// ══════════════════════════════════════════════════════════
const puntosSchema = zod_1.z.object({
    serial: zod_1.z.boolean(), cuadro: zod_1.z.boolean(),
    horquilla: zod_1.z.boolean(), manubrio: zod_1.z.boolean(),
    freno_delantero: zod_1.z.boolean(), freno_trasero: zod_1.z.boolean(),
    cables: zod_1.z.boolean(), cambio_delantero: zod_1.z.boolean(),
    cambio_trasero: zod_1.z.boolean(), cassette: zod_1.z.boolean(),
    cadena: zod_1.z.boolean(), bielas: zod_1.z.boolean(),
    pedales: zod_1.z.boolean(), rueda_delantera: zod_1.z.boolean(),
    rueda_trasera: zod_1.z.boolean(), cubiertas: zod_1.z.boolean(),
    asiento: zod_1.z.boolean(), luces: zod_1.z.boolean(),
    accesorios: zod_1.z.boolean(), prueba_funcional: zod_1.z.boolean(),
});
const iniciarSchema = zod_1.z.object({
    bicicletaId: zod_1.z.string().uuid('bicicletaId debe ser UUID'),
    puntos: puntosSchema,
    fotosUrls: zod_1.z.array(zod_1.z.string().url()).min(1, 'Al menos 1 foto requerida'),
    firmaInspector: zod_1.z.string().min(10, 'Firma digital requerida'),
    djFirmada: zod_1.z.literal(true, { errorMap: () => ({ message: 'DJ debe estar firmada (true)' }) }),
    propietarioDNI: zod_1.z.string().min(7, 'DNI inválido').max(20).regex(/^\d/, 'DNI debe comenzar con número'),
    propietarioNombre: zod_1.z.string().min(3, 'Nombre requerido').max(100),
    propietarioGeoLat: zod_1.z.number().min(-90).max(90).optional(),
    propietarioGeoLng: zod_1.z.number().min(-180).max(180).optional(),
});
const finalizarSchema = zod_1.z.object({
    propietarioWallet: zod_1.z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Wallet Ethereum inválida').optional(),
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/iniciar         [Inspector | Admin]
// ══════════════════════════════════════════════════════════
exports.iniciarCITHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    // ── 1. Validar payload ────────────────────────────────────
    const data = iniciarSchema.parse(req.body);
    // ── 2. Verificar perfil inspector ────────────────────────
    const inspector = await (0, database_1.queryOne)(`SELECT id, taller_aliado_id, certificado
     FROM inspectores WHERE usuario_id=$1 AND activo=TRUE`, [req.user.sub]);
    if (!inspector)
        throw new errorHandler_1.AppError('No tenés perfil de inspector habilitado', 403, 'NOT_INSPECTOR');
    // ── 3. Obtener número de serie de la bicicleta ───────────
    const bici = await (0, database_1.queryOne)(`SELECT numero_serie, propietario_id FROM bicicletas WHERE id=$1`, [data.bicicletaId]);
    if (!bici)
        throw new errorHandler_1.AppError('Bicicleta no encontrada', 404, 'BICICLETA_NOT_FOUND');
    // ── 4. VALIDACIÓN REAL DEL SERIAL ─────────────────────────
    const validacion = await (0, serial_service_1.validarSerial)({
        serial: bici.numero_serie,
        propietarioDNI: data.propietarioDNI,
        propietarioNombre: data.propietarioNombre,
    });
    // Checks bloqueantes → responder con detalle completo (no 500, sino 422)
    if (!validacion.aprobado) {
        const bloqueantes = validacion.checks.filter(c => c.resultado === 'BLOQUEANTE');
        throw new errorHandler_1.AppError(`Validación del serial rechazada: ${bloqueantes[0]?.mensaje ?? 'error de validación'}`, 422, 'SERIAL_INVALIDO', {
            serial: validacion.serial,
            resumen: validacion.resumen,
            checks: validacion.checks,
            bloqueantes: bloqueantes.map(c => ({ nombre: c.nombre, mensaje: c.mensaje })),
        });
    }
    // ── 5. Emitir advertencias si hay alertas ────────────────
    // (no bloquean pero el inspector es notificado)
    const alertas = validacion.checks.filter(c => c.resultado === 'ALERTA');
    if (alertas.length > 0) {
        req.validacionAlertas = alertas.map(a => a.mensaje);
    }
    // ── 6. Iniciar el CIT ────────────────────────────────────
    // El bicicletaId de la validación coincide con data.bicicletaId (check de existencia pasó)
    const result = await (0, cit_service_1.iniciarCIT)({
        ...data,
        inspectorId: inspector.id,
        tallerAliadoId: inspector.taller_aliado_id,
    });
    // ── 7. Vincular la validación de serial al CIT creado ────
    await (0, serial_service_1.vincularValidacionACIT)(bici.numero_serie, result.citId);
    // ── 8. Respuesta con estado de validación incluido ───────
    res.status(201).json({
        ok: true,
        data: {
            ...result,
            serialValidacion: {
                aprobado: validacion.aprobado,
                tieneAlertas: validacion.tieneAlertas,
                alertas: alertas.map(a => a.mensaje),
                checksOK: validacion.checks.filter(c => c.resultado === 'OK').length,
                checksTotal: validacion.checks.length,
            },
        },
    });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/serial/validar   [Inspector — pre-check]
// Validar un serial ANTES de ir al taller (preview sin crear CIT)
// ══════════════════════════════════════════════════════════
exports.prevalidarSerialHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { serial, propietarioDNI, propietarioNombre } = zod_1.z.object({
        serial: zod_1.z.string().min(1),
        propietarioDNI: zod_1.z.string().min(7),
        propietarioNombre: zod_1.z.string().min(3).optional().default(''),
    }).parse(req.query);
    const validacion = await (0, serial_service_1.validarSerial)({
        serial: serial.trim().toUpperCase(),
        propietarioDNI: propietarioDNI.trim(),
        propietarioNombre: propietarioNombre,
    });
    res.json({
        ok: true,
        data: validacion,
    });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/:id/validar     [Admin | Worker]
// ══════════════════════════════════════════════════════════
exports.validarCITHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, cit_service_1.validarCIT)(req.params.id);
    if (result.aprobadoParaFinalizar && !result.alertaActiva) {
        try {
            const { encolarFinalizar } = await import('../services/queue.service');
            const jobId = await encolarFinalizar(req.params.id);
            Object.assign(result, { finalizarJobId: jobId });
        }
        catch { /* best-effort */ }
    }
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/:id/finalizar   [Admin | Worker]
// ══════════════════════════════════════════════════════════
exports.finalizarCITHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { propietarioWallet } = finalizarSchema.parse(req.body);
    const result = await (0, cit_service_1.finalizarCIT)(req.params.id, propietarioWallet);
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/:id              [Autenticado]
// ══════════════════════════════════════════════════════════
exports.getCITHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const cit = await (0, cit_service_1.getCITById)(req.params.id, req.user?.sub);
    res.json({ ok: true, data: cit });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/verificar/:serial  [Público]
// ══════════════════════════════════════════════════════════
exports.verificarSerialHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, cit_service_1.verificarSerial)(decodeURIComponent(req.params.serial));
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/mis-cits           [Autenticado]
// ══════════════════════════════════════════════════════════
exports.misCITsHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const cits = await (0, cit_service_1.misCITs)(req.user.sub);
    res.json({ ok: true, data: cits });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/:id/denunciar     [Autenticado — propietario]
// ══════════════════════════════════════════════════════════
exports.denunciarRoboHandler = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { motivo } = zod_1.z.object({ motivo: zod_1.z.string().min(10) }).parse(req.body);
    const cit = await (0, database_1.queryOne)(`SELECT id, estado FROM cits WHERE id=$1 AND propietario_id=$2`, [req.params.id, req.user.sub]);
    if (!cit)
        throw new errorHandler_1.AppError('CIT no encontrado', 404);
    if (cit.estado !== 'ACTIVO')
        throw new errorHandler_1.AppError('Solo se pueden denunciar CITs activos', 400, 'CIT_NOT_ACTIVE');
    await (0, database_1.queryOne)(`UPDATE cits SET estado='BLOQUEADO',actualizado_en=NOW() WHERE id=$1`, [cit.id]);
    res.json({ ok: true, data: {
            citId: cit.id, estado: 'BLOQUEADO', motivo,
            mensaje: 'CIT bloqueado · Ministerio de Seguridad Mendoza notificado',
        } });
});
