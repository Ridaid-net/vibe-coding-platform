-- RODAID — Sistema de tarifas de denuncia de robo (casos 1/2: dueño denuncia
-- su propia bici). Extiende denuncias_mpf con el fee congelado y un estado
-- intermedio PENDIENTE_PAGO para el caso 2 (sin CIT activo, fee $5.100).
--
-- Caso 1 (CIT activo): fee_ars = 0, fee_motivo = 'CIT_ACTIVO_GRATIS', el flujo
-- sigue exactamente como hoy (activa de inmediato si la validacion del PDF
-- pasa).
-- Caso 2 (sin CIT activo, cuenta gratis): fee_ars = 5100 (congelado desde
-- cit_express_precio_ars en el momento de la denuncia), fee_motivo =
-- 'SIN_CIT_PAGO'. El PDF se valida y se guarda de inmediato (mismo trabajo
-- que hoy), pero la denuncia queda en PENDIENTE_PAGO -- NO se activa
-- (aplicarBloqueo/BFA/notificaciones) hasta que el webhook de MercadoPago
-- confirme el pago. Un solo submit del usuario, sin re-subir el PDF.
--
-- 'estado' es un CHECK constraint (VARCHAR), no un ENUM nativo -- se puede
-- redefinir en una sola transaccion sin la restriccion de ALTER TYPE ADD
-- VALUE. Idempotente: el DO $$ busca el constraint existente por su
-- definicion en vez de asumir el nombre auto-generado por Postgres.

ALTER TABLE denuncias_mpf
  ADD COLUMN IF NOT EXISTS fee_ars NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (fee_ars >= 0),
  ADD COLUMN IF NOT EXISTS fee_motivo VARCHAR(20) NOT NULL DEFAULT 'CIT_ACTIVO_GRATIS'
    CHECK (fee_motivo IN ('CIT_ACTIVO_GRATIS', 'SIN_CIT_PAGO')),
  ADD COLUMN IF NOT EXISTS fee_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS fee_init_point TEXT,
  ADD COLUMN IF NOT EXISTS fee_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS fee_pagado_en TIMESTAMPTZ;

DO $$
DECLARE
  nombre_constraint text;
BEGIN
  SELECT con.conname INTO nombre_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'denuncias_mpf'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%DENUNCIA_JUDICIAL_ACTIVA%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%PENDIENTE_PAGO%';

  IF nombre_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE denuncias_mpf DROP CONSTRAINT %I', nombre_constraint);
  END IF;
END $$;

ALTER TABLE denuncias_mpf
  ADD CONSTRAINT denuncias_mpf_estado_check
  CHECK (estado IN ('DENUNCIA_JUDICIAL_ACTIVA', 'EN_REVISION', 'ANULADA', 'PENDIENTE_PAGO'));

-- Bloquea un segundo intento mientras el primero espera el pago (mismo
-- criterio que la unicidad de denuncia activa, ya existente).
CREATE UNIQUE INDEX IF NOT EXISTS idx_denuncias_mpf_pendiente_pago_unica
  ON denuncias_mpf (bicicleta_id)
  WHERE estado = 'PENDIENTE_PAGO';
