"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashCITPayload = hashCITPayload;
exports.verifyHash = verifyHash;
exports.generarNumeroCIT = generarNumeroCIT;
// ─── RODAID · Servicio de Hash SHA-256 ───────────────────
const crypto_1 = __importDefault(require("crypto"));
// Genera el hash SHA-256 canónico del payload del CIT
// El orden de los campos es fijo para garantizar reproducibilidad
function hashCITPayload(payload) {
    const canonical = JSON.stringify({
        numeroSerie: payload.numeroSerie,
        marca: payload.marca,
        modelo: payload.modelo,
        anio: payload.anio,
        tipo: payload.tipo,
        propietarioDNI: payload.propietarioDNI,
        propietarioNombre: payload.propietarioNombre,
        inspectorId: payload.inspectorId,
        tallerAliadoId: payload.tallerAliadoId,
        puntos: payload.puntos,
        timestamp: payload.timestamp,
        ley: payload.ley,
    });
    return '0x' + crypto_1.default.createHash('sha256').update(canonical, 'utf8').digest('hex');
}
// Verifica que un hash corresponde a un payload
function verifyHash(payload, hashEsperado) {
    return hashCITPayload(payload) === hashEsperado;
}
// Genera número de CIT: RCIT-YYYY-XXXXX
function generarNumeroCIT() {
    const year = new Date().getFullYear();
    const seq = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
    return `RCIT-${year}-${seq}`;
}
