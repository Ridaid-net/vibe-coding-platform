"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verMisDenuncias = exports.recuperar = exports.alertasPorSerial = exports.denunciar = void 0;
const zod_1 = require("zod");
const errorHandler_1 = require("../middleware/errorHandler");
const seguridad_service_1 = require("../services/seguridad.service");
const denunciarSchema = zod_1.z.object({
    citId: zod_1.z.string().uuid('citId debe ser UUID'),
    descripcion: zod_1.z.string().min(20, 'Describí el robo en al menos 20 caracteres').max(1000),
    lugarRobo: zod_1.z.string().max(300).optional(),
    fechaRobo: zod_1.z.string().datetime({ message: 'fechaRobo debe ser ISO 8601' }).optional(),
    denuncianteDNI: zod_1.z.string().min(7).max(10).optional(),
    denuncianteNombre: zod_1.z.string().max(200).optional(),
    denuncianteTelefono: zod_1.z.string().max(30).optional(),
    geoLat: zod_1.z.number().min(-90).max(90).optional(),
    geoLng: zod_1.z.number().min(-180).max(180).optional(),
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/seguridad/denunciar
// ══════════════════════════════════════════════════════════
exports.denunciar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const data = denunciarSchema.parse(req.body);
    const result = await (0, seguridad_service_1.denunciarRobo)({ ...data, denuncianteId: req.user.sub });
    res.status(201).json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/seguridad/alertas/:serial   [público]
// ══════════════════════════════════════════════════════════
exports.alertasPorSerial = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const serial = decodeURIComponent(req.params.serial).toUpperCase().replace(/\s/g, '-');
    const result = await (0, seguridad_service_1.verificarAlertas)(serial);
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/seguridad/denuncias/:id/recuperar
// ══════════════════════════════════════════════════════════
exports.recuperar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const result = await (0, seguridad_service_1.marcarRecuperada)(req.params.id, req.user.sub);
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/seguridad/mis-denuncias
// ══════════════════════════════════════════════════════════
exports.verMisDenuncias = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const result = await (0, seguridad_service_1.misDenuncias)(req.user.sub);
    res.json({ ok: true, data: result });
});
