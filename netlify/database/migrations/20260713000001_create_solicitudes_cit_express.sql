-- RODAID — Cobro real del CIT Express.
--
-- Hasta esta migracion, el CIT Express se emitia y "renovaba" gratis: el
-- precio ($5.100 ARS, parametro cit_express_precio_ars) existia en
-- parametros_pricing_cit pero ningun endpoint de emision lo cobraba (ver
-- CLAUDE.md, hallazgo CRITICO 2026-07-13).
--
-- Regla de negocio confirmada por Federico: el pago se cobra ANTES de iniciar
-- el tramite -- si no paga, el tramite no debe ni empezar a procesarse. Por
-- eso esta tabla es NUEVA y separada de `cits`, no una extension de esa
-- tabla ni de su enum: mientras el pago esta pendiente, NO debe existir
-- ninguna fila en `cits` todavia (nada que "pausar", nada que limpiar si el
-- pago nunca llega). Recien cuando el webhook de MercadoPago confirma el
-- pago (webhookPagoCitExpress(), cit-express.service.ts) se crea el CIT real
-- y arranca el pipeline de validacion de 72hs (encolarValidacion()).
--
-- solicitud_cit_express_estado es un tipo NUEVO, no una extension de un enum
-- existente -- se puede crear y usar en la misma migracion sin el problema
-- de "unsafe use of new value" que documentamos para ALTER TYPE ... ADD VALUE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'solicitud_cit_express_estado') THEN
    CREATE TYPE solicitud_cit_express_estado AS ENUM (
      'pago_pendiente',  -- preferencia de MercadoPago creada, esperando confirmacion
      'pagada',           -- webhook confirmo el pago; el CIT real ya se creo (cit_id)
      'rechazada',        -- MercadoPago informo rejected/cancelled (reintentable)
      'vencida'           -- pasaron 48hs sin pago; hay que iniciar una solicitud nueva
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS solicitudes_cit_express (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  ciclista_id UUID NOT NULL REFERENCES usuarios (id),
  estado solicitud_cit_express_estado NOT NULL DEFAULT 'pago_pendiente',
  monto_ars NUMERIC(12, 2) NOT NULL CHECK (monto_ars > 0),
  fee_preference_id VARCHAR(120),
  fee_init_point TEXT,
  fee_payment_id VARCHAR(120),
  fee_pagado_en TIMESTAMPTZ,
  -- Se completa recien cuando el webhook confirma el pago y crea el CIT real.
  cit_id UUID REFERENCES cits (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_cit_express_bici
  ON solicitudes_cit_express (bicicleta_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_solicitudes_cit_express_ciclista
  ON solicitudes_cit_express (ciclista_id, created_at DESC);

-- Evita dos solicitudes cobrables en simultaneo para la misma bici: mientras
-- haya una en pago_pendiente, un intento nuevo debe reanudar esa (mismo
-- fee_init_point), no crear una segunda preferencia de cobro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_cit_express_pendiente_unica
  ON solicitudes_cit_express (bicicleta_id)
  WHERE estado = 'pago_pendiente';
