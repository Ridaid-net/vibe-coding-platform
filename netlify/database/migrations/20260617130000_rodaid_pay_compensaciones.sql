-- RODAID — Hito 13: RODAID PAY (motor de pagos y compensaciones).
--
-- El nucleo transaccional (escrow + MercadoPago: preferencias, webhook idempotente,
-- maquina de estados, reembolsos y resolucion de disputas) ya vive en la migracion
-- 20260606190000_create_escrow_pagos (escrow_transacciones, mp_pagos, escrow_eventos).
-- Esta migracion suma las piezas que faltaban del hito:
--
--   1) pagos_escrow            — VISTA de compatibilidad con la forma pedida por el
--      hito (id, transaccion_mp_id, monto, estado retenido/liberado/reembolsado,
--      vendedor_id, comprador_id) sobre las tablas normalizadas ya existentes. Es
--      una vista (no una tabla) a proposito: el origen de verdad sigue siendo
--      mp_pagos/escrow_transacciones y se evita el doble registro del dinero.
--
--   2) pagos_liquidaciones     — LIBRO DE COMPENSACIONES (deudas a pagar). Unifica
--      dos flujos de "compensacion": el pago al VENDEDOR al liberarse el escrow
--      (precio - comision) y la RETRIBUCION proporcional al Taller Aliado cuando un
--      CIT se emite y valida con exito. Una liquidacion nace PENDIENTE (registro de
--      deuda) y la transferencia real la ejecuta un barrido asincrono; si la
--      transferencia al vendedor falla, el escrow vuelve a DISPUTADA (revision
--      humana). Idempotente por (origen_tipo, origen_id, tipo, beneficiario_id).
--
--   3) tasas_cit               — pago de la TASA CIT OFICIAL por el canal del
--      Gobierno (Mendoza por Mi, pasarela estatal). Idempotente por la referencia
--      externa de la pasarela.
--
--   4) pagos_log               — bitacora financiera INMUTABLE (append-only): cada
--      registro financiero (liquidacion creada/pagada/fallida, retribucion, tasa
--      pagada, resolucion forzada de disputa) queda escrito y NO admite UPDATE ni
--      DELETE (trigger + REVOKE), por exigencia del hito (logs inmutables).
--
-- Restricciones del hito respetadas a nivel de esquema:
--   - El dinero nunca lo "toca" la logica de negocio: el deposito/credito siempre
--     proviene del webhook asincrono de MercadoPago (ver mp_pagos / escrow.service).
--   - Idempotencia obligatoria: indices unicos en cada punto de reproceso.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) pagos_escrow — vista de compatibilidad con la forma pedida por el hito.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW pagos_escrow AS
SELECT
  p.id,
  -- transaccion_mp_id: el identificador del pago en MercadoPago (NULL hasta que
  -- el webhook confirma el deposito real de los fondos).
  p.payment_id        AS transaccion_mp_id,
  p.monto,
  -- estado normalizado a la nomenclatura del hito (retenido/liberado/reembolsado).
  CASE p.estado
    WHEN 'FONDOS_RETENIDOS' THEN 'retenido'
    WHEN 'LIBERADO'         THEN 'liberado'
    WHEN 'REEMBOLSADO'      THEN 'reembolsado'
    WHEN 'RECHAZADO'        THEN 'rechazado'
    ELSE 'pendiente'
  END                 AS estado,
  t.vendedor_id,
  t.comprador_id,
  p.transaccion_id    AS escrow_transaccion_id,
  p.created_at,
  p.updated_at
FROM mp_pagos p
JOIN escrow_transacciones t ON t.id = p.transaccion_id;

-- ---------------------------------------------------------------------------
-- 2) pagos_liquidaciones — libro de compensaciones (deudas a pagar).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'liquidacion_tipo') THEN
    CREATE TYPE liquidacion_tipo AS ENUM (
      'VENDEDOR',           -- pago al vendedor al liberarse el escrow (precio - comision)
      'ALIADO_RETRIBUCION'  -- retribucion proporcional al Taller Aliado por un CIT validado
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'liquidacion_estado') THEN
    CREATE TYPE liquidacion_estado AS ENUM (
      'PENDIENTE',  -- deuda registrada; la transferencia aun no se ejecuto
      'PAGADA',     -- transferencia ejecutada con exito
      'FALLIDA',    -- la transferencia fallo (escrow vuelve a disputa para revision)
      'CANCELADA'   -- anulada (p. ej. la transaccion origen se reembolso)
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS pagos_liquidaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo liquidacion_tipo NOT NULL,
  estado liquidacion_estado NOT NULL DEFAULT 'PENDIENTE',

  -- Beneficiario de la compensacion: una cuenta de usuario (vendedor) o un aliado.
  beneficiario_id UUID NOT NULL,
  beneficiario_tipo VARCHAR(20) NOT NULL DEFAULT 'usuario', -- 'usuario' | 'aliado'

  -- Hecho economico que origina la deuda.
  origen_tipo VARCHAR(20) NOT NULL,  -- 'ESCROW' | 'CIT'
  origen_id UUID NOT NULL,
  transaccion_id UUID REFERENCES escrow_transacciones (id) ON DELETE SET NULL,
  cit_id UUID REFERENCES cits (id) ON DELETE SET NULL,

  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  -- Base e indice usados para calcular el monto (auditoria del calculo).
  base_calculo NUMERIC(12,2),
  tasa_aplicada NUMERIC(6,4),

  intentos INTEGER NOT NULL DEFAULT 0,
  transferencia_ref VARCHAR(160),
  ultimo_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pagado_en TIMESTAMPTZ
);

-- Idempotencia: una sola liquidacion por hecho economico y beneficiario.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_liquidaciones_unica
  ON pagos_liquidaciones (origen_tipo, origen_id, tipo, beneficiario_id);

CREATE INDEX IF NOT EXISTS idx_pagos_liquidaciones_estado
  ON pagos_liquidaciones (estado, created_at);

CREATE INDEX IF NOT EXISTS idx_pagos_liquidaciones_beneficiario
  ON pagos_liquidaciones (beneficiario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pagos_liquidaciones_tipo
  ON pagos_liquidaciones (tipo, estado);

-- Barrido de transferencias pendientes (worker).
CREATE INDEX IF NOT EXISTS idx_pagos_liquidaciones_pendientes
  ON pagos_liquidaciones (created_at)
  WHERE estado = 'PENDIENTE';

-- Reutiliza la funcion de touch de `usuarios` (Hito 1) para updated_at.
DROP TRIGGER IF EXISTS trg_pagos_liquidaciones_updated_at ON pagos_liquidaciones;
CREATE TRIGGER trg_pagos_liquidaciones_updated_at
  BEFORE UPDATE ON pagos_liquidaciones
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3) tasas_cit — pago de la Tasa CIT oficial por el canal del Gobierno (MxM).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tasa_cit_estado') THEN
    CREATE TYPE tasa_cit_estado AS ENUM (
      'PENDIENTE',  -- intencion de pago creada; esperando confirmacion de la pasarela
      'PAGADA',     -- la pasarela estatal confirmo el pago
      'RECHAZADA',  -- la pasarela rechazo o cancelo el pago
      'EXPIRADA'    -- la intencion vencio sin pago
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS tasas_cit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relacion estricta con el bien/CIT que paga la tasa (ambos opcionales: la tasa
  -- puede iniciarse antes de existir el CIT, atada a la bicicleta).
  cit_id UUID REFERENCES cits (id) ON DELETE SET NULL,
  bicicleta_id UUID REFERENCES bicicletas (id) ON DELETE SET NULL,
  solicitante_id UUID REFERENCES usuarios (id) ON DELETE SET NULL,

  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  canal VARCHAR(20) NOT NULL DEFAULT 'MxM',
  estado tasa_cit_estado NOT NULL DEFAULT 'PENDIENTE',

  -- Identidad del pago en la pasarela estatal. Idempotencia del webhook/confirmacion.
  referencia_externa VARCHAR(160),
  comprobante VARCHAR(160),
  -- `sub`/uid de la persona en MxM si el pago se inicio con identidad federada.
  external_uid VARCHAR(160),

  checkout_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pagado_en TIMESTAMPTZ
);

-- Idempotencia: una referencia de pasarela no se procesa dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasas_cit_referencia
  ON tasas_cit (referencia_externa)
  WHERE referencia_externa IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasas_cit_cit ON tasas_cit (cit_id);
CREATE INDEX IF NOT EXISTS idx_tasas_cit_solicitante
  ON tasas_cit (solicitante_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasas_cit_estado
  ON tasas_cit (estado, created_at DESC);

DROP TRIGGER IF EXISTS trg_tasas_cit_updated_at ON tasas_cit;
CREATE TRIGGER trg_tasas_cit_updated_at
  BEFORE UPDATE ON tasas_cit
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4) pagos_log — bitacora financiera INMUTABLE (append-only).
--    Cada registro financiero queda escrito y no se puede alterar ni borrar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evento VARCHAR(60) NOT NULL,
  origen_tipo VARCHAR(20),   -- 'ESCROW' | 'CIT' | 'LIQUIDACION' | 'TASA'
  origen_id UUID,
  monto NUMERIC(12,2),
  beneficiario_id UUID,
  actor_id UUID,
  actor_rol VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_log_origen
  ON pagos_log (origen_tipo, origen_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pagos_log_evento
  ON pagos_log (evento, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pagos_log_created
  ON pagos_log (created_at DESC);

-- INMUTABILIDAD: append-only. Un trigger BEFORE UPDATE/DELETE aborta cualquier
-- intento (mismo patron que ministerio_auditoria, Hito 12).
CREATE OR REPLACE FUNCTION pagos_log_inmutable()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pagos_log es append-only: no se permite %', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_pagos_log_no_update ON pagos_log;
CREATE TRIGGER trg_pagos_log_no_update
  BEFORE UPDATE OR DELETE ON pagos_log
  FOR EACH ROW
  EXECUTE FUNCTION pagos_log_inmutable();

-- Defensa en profundidad: revoca el permiso a nivel de tabla.
REVOKE UPDATE, DELETE, TRUNCATE ON pagos_log FROM PUBLIC;
