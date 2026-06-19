"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = exports.AppError = void 0;
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const logger_1 = require("./logger");
class AppError extends Error {
    message;
    statusCode;
    code;
    details;
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details) {
        super(message);
        this.message = message;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
function errorHandler(err, req, res, _next) {
    // Zod validation errors
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: err.flatten().fieldErrors },
        });
    }
    // Errores de aplicación controlados
    if (err instanceof AppError) {
        if (err.statusCode >= 500)
            logger_1.logger.error({ err, url: req.url }, err.message);
        return res.status(err.statusCode).json({
            ok: false,
            error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
        });
    }
    // Error no controlado
    logger_1.logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');
    return res.status(500).json({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    });
}
// Wrapper para rutas async — evita try/catch repetitivo
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
exports.asyncHandler = asyncHandler;
