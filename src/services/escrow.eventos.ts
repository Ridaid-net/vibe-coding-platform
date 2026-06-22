// ─── RODAID · Escrow Eventos Helper ─────────────────────
// Exportado como módulo separado para evitar dependencias circulares
// entre escrow.service y nft.transfer.service.

import { query } from '../config/database'
import { log }   from '../middleware/logger'

export interface EscrowEvento {
  transaccionId: string
  evento:        string
  estadoPrevio?: string
  estadoNuevo?:  string
  actorId?:      string
  actorTipo?:    'COMPRADOR' | 'VENDEDOR' | 'SISTEMA' | 'ADMIN'
  datos?:        Record<string, unknown>
  ip?:           string
}

export async function registrarEvento(opts: EscrowEvento): Promise<void> {
  await query(
    `INSERT INTO escrow_eventos
       (transaccion_id, evento, estado_previo, estado_nuevo,
        actor_id, actor_tipo, datos, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      opts.transaccionId, opts.evento,
      opts.estadoPrevio ?? null, opts.estadoNuevo ?? null,
      opts.actorId ?? null, opts.actorTipo ?? null,
      opts.datos ? JSON.stringify(opts.datos) : null,
      opts.ip ?? null,
    ]
  ).catch(err => log.escrow.warn({ err: err.message }, 'Error registrando evento escrow'))
}
