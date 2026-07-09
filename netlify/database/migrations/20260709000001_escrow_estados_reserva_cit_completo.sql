-- RODAID — Fase 6: estados de escrow para el flujo de dos pagos de CIT Completo
-- (sena -> certificacion, saldo -> venta).
--
-- IMPORTANTE: esta migracion SOLO agrega valores de enum y una columna. No los
-- usa en ningun UPDATE/INSERT/indice -- eso va en 20260709000002, en un
-- deploy separado, por la regla documentada en CLAUDE.md (un ALTER TYPE ADD
-- VALUE y su primer uso no pueden compartir deploy).
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

ALTER TYPE escrow_transaccion_estado ADD VALUE IF NOT EXISTS 'RESERVA_PENDIENTE';
ALTER TYPE escrow_transaccion_estado ADD VALUE IF NOT EXISTS 'RESERVADA';
ALTER TYPE escrow_transaccion_estado ADD VALUE IF NOT EXISTS 'SALDO_PENDIENTE';
ALTER TYPE escrow_transaccion_estado ADD VALUE IF NOT EXISTS 'RESERVA_VENCIDA';

-- Distingue a que cobro corresponde cada fila de mp_pagos (hoy solo existe
-- 'venta', el pago unico del flujo generico). 'sena' y 'saldo' son los dos
-- cobros secuenciales del flujo de CIT Completo.
ALTER TABLE mp_pagos
  ADD COLUMN IF NOT EXISTS concepto VARCHAR(20) NOT NULL DEFAULT 'venta';
