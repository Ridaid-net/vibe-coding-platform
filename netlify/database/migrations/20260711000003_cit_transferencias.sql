-- RODAID — Transferencia real de titularidad al completarse una venta.
--
-- Hasta esta migracion, NINGUN flujo actualizaba bicicletas.propietario_id al
-- vender -- el comprador nunca quedaba como dueno real, ni en el flujo
-- generico (que si tiene cierre) ni en CIT Completo (que ni tenia endpoint de
-- cierre). El email de "compra completada" ya decia lo contrario.
--
-- cit_transferencias es el ledger de cada cambio de titularidad: preserva el
-- historial completo de una bici a traves de sus duenos. El CIT nunca se
-- revoca ni se re-emite al vender ni al transferir manualmente (misma
-- huella, mismo codigo de siempre) -- las columnas bfa_* de `cits` ya estan
-- ocupadas por el mint original, por eso el anclaje de la transferencia
-- necesita su propio lugar. Reusa el enum cit_bfa_estado existente
-- (NO_INICIADA/PENDIENTE/ACUNADO/ERROR/FALLIDO).

CREATE TABLE IF NOT EXISTS cit_transferencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL REFERENCES cits(id),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas(id),
  escrow_transaccion_id UUID REFERENCES escrow_transacciones(id),
  propietario_anterior_id UUID NOT NULL REFERENCES usuarios(id),
  propietario_nuevo_id UUID NOT NULL REFERENCES usuarios(id),
  motivo VARCHAR(30) NOT NULL CHECK (motivo IN ('venta_marketplace', 'transferencia_manual')),
  bfa_estado cit_bfa_estado NOT NULL DEFAULT 'PENDIENTE',
  bfa_tx_hash TEXT,
  bfa_stamp_id TEXT,
  bfa_objeto_id TEXT,
  bfa_ultimo_error TEXT,
  actor_id UUID REFERENCES usuarios(id),
  actor_rol VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cit_transferencias_cit ON cit_transferencias (cit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cit_transferencias_bfa_pendiente
  ON cit_transferencias (bfa_estado) WHERE bfa_estado IN ('PENDIENTE', 'ERROR');
