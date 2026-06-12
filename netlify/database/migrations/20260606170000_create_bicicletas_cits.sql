-- RODAID — Fundaciones del Marketplace: rodados (bicicletas) y sus
-- Certificados de Identificacion (CIT).
--
-- Estas tablas son la base sobre la que se apoyan las publicaciones del
-- marketplace y el escrow: la publicacion referencia una bicicleta y se
-- autoriza contra un CIT activo del propietario. Deben existir ANTES de
-- 20260606180000_create_marketplace_publicaciones, cuyo trigger de busqueda
-- lee marca/modelo/numero_serie desde `bicicletas`.

CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id UUID NOT NULL,
  marca VARCHAR(80) NOT NULL,
  modelo VARCHAR(80) NOT NULL,
  anio INTEGER,
  tipo VARCHAR(40),
  numero_serie VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bicicletas_anio_valido
    CHECK (anio IS NULL OR anio BETWEEN 1900 AND 2100)
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id);

CREATE INDEX IF NOT EXISTS idx_bicicletas_marca
  ON bicicletas (marca);

CREATE INDEX IF NOT EXISTS idx_bicicletas_tipo
  ON bicicletas (tipo);

CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  estado VARCHAR(30) NOT NULL DEFAULT 'ACTIVO',
  fecha_vencimiento TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cits_bicicleta
  ON cits (bicicleta_id);

-- Un unico CIT vivo por rodado (refuerza la regla de "un CIT activo por
-- bicicleta" que asume el flujo de publicacion del marketplace).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_unico_activo_por_bicicleta
  ON cits (bicicleta_id)
  WHERE estado = 'ACTIVO';
