-- RODAID PAY — Fase B: pasarela de pago (MercadoPago) y maquina de estados del Escrow.
-- Crea las transacciones de escrow, el registro de pagos de MercadoPago (mp_pagos)
-- y el audit trail (escrow_eventos). Las publicaciones ya existen (Fase A).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escrow_transaccion_estado') THEN
    CREATE TYPE escrow_transaccion_estado AS ENUM (
      'DEPOSITO_PENDIENTE',
      'FONDOS_RETENIDOS',
      'EN_CAMINO',
      'COMPLETADA',
      'CANCELADA',
      'DISPUTADA'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mp_pago_estado') THEN
    CREATE TYPE mp_pago_estado AS ENUM (
      'PENDIENTE',
      'FONDOS_RETENIDOS',
      'LIBERADO',
      'REEMBOLSADO',
      'RECHAZADO'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS escrow_transacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publicacion_id UUID NOT NULL REFERENCES marketplace_publicaciones (id),
  comprador_id UUID NOT NULL,
  vendedor_id UUID NOT NULL,
  estado escrow_transaccion_estado NOT NULL DEFAULT 'DEPOSITO_PENDIENTE',
  plan VARCHAR(20) NOT NULL DEFAULT 'LIBRE',
  precio_ars NUMERIC(12,2) NOT NULL CHECK (precio_ars > 0),
  comision_rodaid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (comision_rodaid >= 0),
  monto_vendedor NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monto_vendedor >= 0),
  gateway VARCHAR(20) NOT NULL DEFAULT 'stub',
  preference_id VARCHAR(120),
  init_point TEXT,
  tracking_code VARCHAR(120),
  disputa_motivo TEXT,
  cancelacion_motivo TEXT,
  deposito_confirmado_en TIMESTAMPTZ,
  envio_confirmado_en TIMESTAMPTZ,
  entrega_confirmada_en TIMESTAMPTZ,
  auto_release_en TIMESTAMPTZ,
  expira_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT escrow_transacciones_comprador_distinto_vendedor
    CHECK (comprador_id <> vendedor_id)
);

-- Una sola transaccion "viva" por publicacion (refuerza el anti-doble-compra).
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_tx_unica_viva_por_publicacion
  ON escrow_transacciones (publicacion_id)
  WHERE estado IN ('DEPOSITO_PENDIENTE', 'FONDOS_RETENIDOS', 'EN_CAMINO', 'DISPUTADA');

CREATE INDEX IF NOT EXISTS idx_escrow_tx_comprador
  ON escrow_transacciones (comprador_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_escrow_tx_vendedor
  ON escrow_transacciones (vendedor_id, created_at DESC);

-- Para el barrido de auto-release: transacciones EN_CAMINO cuyo plazo vencio.
CREATE INDEX IF NOT EXISTS idx_escrow_tx_auto_release
  ON escrow_transacciones (auto_release_en)
  WHERE estado = 'EN_CAMINO';

CREATE TABLE IF NOT EXISTS mp_pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID NOT NULL REFERENCES escrow_transacciones (id),
  preference_id VARCHAR(120),
  payment_id VARCHAR(120),
  estado mp_pago_estado NOT NULL DEFAULT 'PENDIENTE',
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  gateway VARCHAR(20) NOT NULL DEFAULT 'stub',
  refund_id VARCHAR(120),
  raw_status VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotencia del webhook: un payment_id de MercadoPago no se procesa dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_pagos_payment_id
  ON mp_pagos (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mp_pagos_transaccion
  ON mp_pagos (transaccion_id, created_at DESC);

CREATE TABLE IF NOT EXISTS escrow_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID NOT NULL REFERENCES escrow_transacciones (id),
  tipo VARCHAR(60) NOT NULL,
  estado_anterior escrow_transaccion_estado,
  estado_nuevo escrow_transaccion_estado,
  actor_id UUID,
  actor_rol VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_eventos_transaccion
  ON escrow_eventos (transaccion_id, created_at ASC);
