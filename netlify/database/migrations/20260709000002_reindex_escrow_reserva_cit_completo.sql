-- RODAID — Fase 6 (cont.): reindexar unicidad de escrow vivo por publicacion,
-- ahora que los valores de enum de 20260709000001 ya commitearon.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

DROP INDEX IF EXISTS idx_escrow_tx_unica_viva_por_publicacion;

CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_tx_unica_viva_por_publicacion
  ON escrow_transacciones (publicacion_id)
  WHERE estado IN (
    'DEPOSITO_PENDIENTE', 'FONDOS_RETENIDOS', 'EN_CAMINO', 'DISPUTADA',
    'RESERVA_PENDIENTE', 'RESERVADA', 'SALDO_PENDIENTE'
  );
