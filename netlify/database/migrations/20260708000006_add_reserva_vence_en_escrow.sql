-- RODAID — Fase 5: timeout de 48hs de la reserva del Marketplace (CIT Completo).
--
-- Agrega el reloj de la ventana de 48hs de una reserva de CIT Completo, sobre
-- la cual corre procesarReservasVencidas() (escrow.service.ts). Es un reloj
-- distinto del ya existente auto_release_en (5 dias, etapa de confirmacion de
-- ENVIO tras la venta) -- son etapas diferentes del ciclo de vida del pago y
-- no deben compartir columna.
--
-- Esta columna queda sin poblar hasta que existan los endpoints de reserva
-- (Fase 6, que crean la escrow_transaccion al confirmarse la sena del
-- comprador). El indice parcial no filtra por estado a proposito -- todavia
-- no esta definido que valor de escrow_transaccion_estado representa
-- "reservado, esperando confirmacion de pago" (lo define la Fase 6); filtrar
-- solo por "no nulo" es siempre correcto sin importar que estado se use.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

ALTER TABLE escrow_transacciones
  ADD COLUMN IF NOT EXISTS reserva_vence_en TIMESTAMPTZ;

-- Para el barrido de reservas vencidas.
CREATE INDEX IF NOT EXISTS idx_escrow_tx_reserva_vence
  ON escrow_transacciones (reserva_vence_en)
  WHERE reserva_vence_en IS NOT NULL;
