-- RODAID — Fase 0: registro base de rodados.
-- Crea las tablas fundacionales `bicicletas` (rodados registrados) y `cits`
-- (Certificado de Identidad del Rodado). El Marketplace (Fase A) y el Escrow
-- (Fase B) dependen de estas tablas: las consultas de publicacion/busqueda
-- hacen JOIN contra `bicicletas`/`cits` y el trigger de search_vector lee de
-- `bicicletas`. Esta migracion debe aplicarse ANTES que la del Marketplace.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'ACTIVO',
      'VENCIDO',
      'SUSPENDIDO',
      'BAJA'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id UUID NOT NULL,
  marca VARCHAR(120) NOT NULL,
  modelo VARCHAR(120) NOT NULL,
  anio INTEGER CHECK (anio IS NULL OR (anio >= 1900 AND anio <= 2100)),
  tipo VARCHAR(60) NOT NULL DEFAULT 'OTRO',
  numero_serie VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id);

CREATE INDEX IF NOT EXISTS idx_bicicletas_marca
  ON bicicletas (marca);

CREATE INDEX IF NOT EXISTS idx_bicicletas_tipo
  ON bicicletas (tipo);

CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  estado cit_estado NOT NULL DEFAULT 'ACTIVO',
  fecha_emision TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un unico CIT vigente por rodado (refuerza la integridad del certificado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_unico_activo_por_bicicleta
  ON cits (bicicleta_id)
  WHERE estado = 'ACTIVO';

CREATE INDEX IF NOT EXISTS idx_cits_bicicleta
  ON cits (bicicleta_id);

CREATE INDEX IF NOT EXISTS idx_cits_estado_vencimiento
  ON cits (estado, fecha_vencimiento);
