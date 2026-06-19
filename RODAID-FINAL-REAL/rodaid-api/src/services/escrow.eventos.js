"use strict";
// ─── RODAID · Escrow Eventos Helper ─────────────────────
// Exportado como módulo separado para evitar dependencias circulares
// entre escrow.service y nft.transfer.service.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarEvento = registrarEvento;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
async function registrarEvento(opts) {
    await (0, database_1.query)(`INSERT INTO escrow_eventos
       (transaccion_id, evento, estado_previo, estado_nuevo,
        actor_id, actor_tipo, datos, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        opts.transaccionId, opts.evento,
        opts.estadoPrevio ?? null, opts.estadoNuevo ?? null,
        opts.actorId ?? null, opts.actorTipo ?? null,
        opts.datos ? JSON.stringify(opts.datos) : null,
        opts.ip ?? null,
    ]).catch(err => logger_1.log.escrow.warn({ err: err.message }, 'Error registrando evento escrow'));
}
