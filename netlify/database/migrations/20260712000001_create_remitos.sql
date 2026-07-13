-- RODAID — Remito de Embalaje y Despacho (CIT Completo).
--
-- Formaliza, con un documento firmado, la orden de trabajo de embalaje que el
-- vendedor le da al Taller Aliado apenas se confirma el saldo de una venta de
-- CIT Completo -- y, en un segundo paso, sirve como comprobante firmado de que
-- el Taller efectivamente embalo y despacho la bici. Dos actos distintos sobre
-- la misma fila: GENERADO (el vendedor dispara la orden) -> DESPACHADO (el
-- Taller confirma el trabajo hecho, firmado con su wallet_address -- mismo
-- mecanismo que ya firma las actas de inspeccion de 20 puntos).
--
-- No reemplaza ni toca inspecciones_fisicas: esa tabla audita la VERIFICACION
-- fisica (Hito 11); esta audita el EMBALAJE/DESPACHO (Fase 6, posterior).
--
-- remito_estado es un tipo NUEVO, no una extension de un enum existente -- se
-- puede crear y usar en la misma migracion sin el problema de "unsafe use of
-- new value" que documentamos para ALTER TYPE ... ADD VALUE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'remito_estado') THEN
    CREATE TYPE remito_estado AS ENUM (
      'GENERADO',    -- el vendedor genero la orden de trabajo; taller notificado
      'DESPACHADO'   -- el taller embalo, firmo y despacho la bici
    );
  END IF;
END
$$;

-- Correlativo real y legible (REM-2026-000001, ...). La app formatea el numero
-- final combinando el anio con nextval(); la secuencia solo garantiza que no
-- se repita.
CREATE SEQUENCE IF NOT EXISTS remitos_numero_seq;

CREATE TABLE IF NOT EXISTS remitos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero VARCHAR(20) UNIQUE NOT NULL,
  transaccion_id UUID NOT NULL UNIQUE REFERENCES escrow_transacciones (id),
  aliado_id UUID NOT NULL REFERENCES aliados (id),
  vendedor_id UUID NOT NULL REFERENCES usuarios (id),
  estado remito_estado NOT NULL DEFAULT 'GENERADO',
  -- Huella SHA-256 del PDF firmado (integridad del documento emitido).
  pdf_documento_hash VARCHAR(64) NOT NULL,
  generado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Confirmacion de despacho (segunda parte del flujo). NULL hasta que el
  -- taller escanea/firma. firma_wallet es un snapshot: si el usuario cambia su
  -- wallet despues, este valor no se actualiza retroactivamente (misma
  -- disciplina que inspecciones_fisicas.inspector_wallet). Mismas columnas de
  -- firma que inspecciones_fisicas (20260616210000_inspector_firma_pkcs12.sql):
  -- no solo la huella (firma_hash), tambien la firma completa verificable
  -- offline (algoritmo, valor, certificado del firmante, serie, fingerprint,
  -- modo PKCS12/DEV) -- mismo mecanismo de firma.service.ts, no uno nuevo.
  despachado_en TIMESTAMPTZ,
  firmado_por UUID REFERENCES usuarios (id),
  firma_wallet VARCHAR(64),
  firma_hash VARCHAR(64),
  firma_algoritmo VARCHAR(48),
  firma_valor TEXT,
  firma_certificado TEXT,
  firma_cert_serie VARCHAR(80),
  firma_cert_fingerprint VARCHAR(95),
  firma_modo VARCHAR(16),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remitos_aliado ON remitos (aliado_id, estado);
CREATE INDEX IF NOT EXISTS idx_remitos_vendedor ON remitos (vendedor_id);

-- ---------------------------------------------------------------------------
-- escrow_transacciones: reloj de espera del Remito.
--
-- saldo_confirmado_en se estampa en el webhook de pago, rama
-- SALDO_PENDIENTE -> FONDOS_RETENIDOS (el momento exacto en que arranca la
-- espera del Remito). Deliberadamente NO se reusa `updated_at` para esto: esa
-- columna la pisa cualquier UPDATE posterior a la fila, incluidos los propios
-- recordatorios -- reusarla rompería tanto el conteo de 7 dias (escalar a
-- disputa) como el throttle de los recordatorios mismos.
-- ---------------------------------------------------------------------------
ALTER TABLE escrow_transacciones
  ADD COLUMN IF NOT EXISTS saldo_confirmado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remito_recordatorio_in_app_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remito_recordatorio_email_en TIMESTAMPTZ;

-- Barrido del worker de recordatorios: transacciones con saldo confirmado,
-- de CIT Completo (aliado_id NOT NULL), sin remito generado todavia.
CREATE INDEX IF NOT EXISTS idx_escrow_remito_pendiente
  ON escrow_transacciones (saldo_confirmado_en)
  WHERE estado = 'FONDOS_RETENIDOS' AND aliado_id IS NOT NULL;
