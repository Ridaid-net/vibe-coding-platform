-- RODAID — Dominio del Garaje Digital.
-- Crea las bicicletas de cada usuario y sus tres activos asociados:
--   · cits                      → Certificado de Identidad Tecnologica (CIT)
--   · certificados_asegurabilidad → score de asegurabilidad
--   · polizas                   → poliza de seguro vigente
--
-- La tabla `bicicletas` ya era referenciada por el modulo Marketplace
-- (INNER JOIN bicicletas + trigger de search_vector) pero hasta ahora no
-- existia ninguna migracion que la creara. Esta migracion la introduce y
-- da soporte al endpoint optimizado GET /api/v1/garaje/resumen.

-- ─── Tipos enumerados ──────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'ACTIVO',
      'EXPIRADO',
      'BORRADOR',
      'PENDIENTE_PAGO'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cert_aseg_nivel') THEN
    CREATE TYPE cert_aseg_nivel AS ENUM (
      'EXCELENTE',
      'BUENO',
      'REGULAR',
      'INSUFICIENTE'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'poliza_estado') THEN
    CREATE TYPE poliza_estado AS ENUM (
      'ACTIVA',
      'VENCIDA',
      'CANCELADA'
    );
  END IF;
END
$$;

-- ─── bicicletas ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id UUID NOT NULL,
  marca VARCHAR(80) NOT NULL,
  modelo VARCHAR(80) NOT NULL,
  anio INTEGER CHECK (anio IS NULL OR (anio >= 1900 AND anio <= 2100)),
  tipo VARCHAR(40),
  numero_serie VARCHAR(80) NOT NULL UNIQUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id, creado_en DESC);

-- ─── cits (Certificado de Identidad Tecnologica) ───────────────────────

CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL UNIQUE REFERENCES bicicletas (id) ON DELETE CASCADE,
  numero_cit VARCHAR(40) NOT NULL UNIQUE,
  estado cit_estado NOT NULL DEFAULT 'BORRADOR',
  puntos_total INTEGER NOT NULL DEFAULT 0 CHECK (puntos_total >= 0),
  puntaje_max INTEGER NOT NULL DEFAULT 20 CHECK (puntaje_max > 0),
  hash_sha256 TEXT,
  hash_bfa BOOLEAN NOT NULL DEFAULT FALSE,
  nft_token_id VARCHAR(80),
  tasa_pagada BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_emision TIMESTAMPTZ,
  fecha_vencimiento TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cits_bicicleta ON cits (bicicleta_id);
CREATE INDEX IF NOT EXISTS idx_cits_estado ON cits (estado);

-- ─── certificados_asegurabilidad ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS certificados_asegurabilidad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL UNIQUE REFERENCES bicicletas (id) ON DELETE CASCADE,
  numero VARCHAR(40) NOT NULL UNIQUE,
  score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  nivel cert_aseg_nivel NOT NULL,
  asegurable BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_aseg_bicicleta
  ON certificados_asegurabilidad (bicicleta_id);

-- ─── polizas ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS polizas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  numero_poliza VARCHAR(40) NOT NULL UNIQUE,
  aseguradora VARCHAR(80) NOT NULL,
  prima_final_ars NUMERIC(12,2) NOT NULL CHECK (prima_final_ars > 0),
  estado poliza_estado NOT NULL DEFAULT 'ACTIVA',
  inicio_vigencia TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fin_vigencia TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_polizas_bicicleta_estado
  ON polizas (bicicleta_id, estado, fin_vigencia DESC);
