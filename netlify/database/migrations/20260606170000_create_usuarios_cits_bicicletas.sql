-- RODAID — Tablas de soporte del dominio (usuarios, bicicletas y CITs).
--
-- Estas tablas son dependencias directas del modulo Marketplace y del Escrow:
--   * marketplace_publicaciones hace JOIN contra `bicicletas` y `cits`, y su
--     trigger `mp_update_search_vector()` lee marca/modelo/numero_serie de
--     `bicicletas`.
--   * Los identificadores vendedor_id / comprador_id / propietario_id / actor_id
--     referencian a `usuarios`.
--
-- Por eso esta migracion lleva un timestamp ANTERIOR (170000) al de las
-- migraciones de marketplace (180000) y escrow (190000): debe aplicarse primero
-- para que esos objetos resuelvan contra tablas reales.

-- ── usuarios ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(160),
  email VARCHAR(254) UNIQUE,
  telefono VARCHAR(40),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── bicicletas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id UUID NOT NULL REFERENCES usuarios (id),
  marca VARCHAR(120) NOT NULL,
  modelo VARCHAR(120) NOT NULL,
  anio INTEGER CHECK (anio IS NULL OR (anio BETWEEN 1900 AND 2100)),
  tipo VARCHAR(60),
  numero_serie VARCHAR(120),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id);

-- ── cits (Certificado de Identificacion y Titularidad) ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'ACTIVO',
      'SUSPENDIDO',
      'VENCIDO',
      'BAJA'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  estado cit_estado NOT NULL DEFAULT 'ACTIVO',
  fecha_emision TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cits_bicicleta ON cits (bicicleta_id);
CREATE INDEX IF NOT EXISTS idx_cits_estado ON cits (estado);
