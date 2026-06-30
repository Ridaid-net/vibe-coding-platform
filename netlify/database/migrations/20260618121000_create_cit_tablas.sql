-- RODAID — Modulo 4 (parte 2/3): tablas del CIT (bicicletas, cits, cit_eventos).

-- Tabla bicicletas
CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id UUID NOT NULL,
  marca VARCHAR(80),
  modelo VARCHAR(80),
  anio INTEGER CHECK (anio IS NULL OR (anio >= 1900 AND anio <= 2100)),
  tipo VARCHAR(40),
  numero_serie VARCHAR(120) NOT NULL,
  numero_cuadro VARCHAR(120),
  color VARCHAR(40),
  rodado VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bicicletas_numero_serie_unico UNIQUE (numero_serie)
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id);

-- Tabla cits
CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  ciclista_id UUID NOT NULL,
  aliado_id UUID NOT NULL,
  aliado_nombre VARCHAR(160),
  estado cit_estado NOT NULL DEFAULT 'PENDIENTE_VALIDACION',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  bicicleta_serial VARCHAR(120) NOT NULL,
  inspeccion JSONB NOT NULL DEFAULT '[]'::jsonb,
  coordenadas_gps JSONB,
  fotos_hashes JSONB,
  alerta_gps BOOLEAN NOT NULL DEFAULT FALSE,
  huella_sha256 CHAR(64) NOT NULL,
  firma_hmac VARCHAR(128) NOT NULL,
  algoritmo VARCHAR(60) NOT NULL,
  snapshot_canonico TEXT NOT NULL,
  sellado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_en TIMESTAMPTZ NOT NULL,
  validado_por UUID,
  validado_en TIMESTAMPTZ,
  fecha_emision TIMESTAMPTZ,
  fecha_vencimiento TIMESTAMPTZ,
  bfa_estado cit_bfa_estado NOT NULL DEFAULT 'NO_INICIADA',
  bfa_tx_hash VARCHAR(120),
  bfa_stamp_id VARCHAR(120),
  bfa_objeto_id VARCHAR(120),
  acunado_en TIMESTAMPTZ,
  revocacion_motivo TEXT,
  revocado_por UUID,
  revocado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cits_activo_vigente CHECK (
    estado <> 'ACTIVO'
    OR (fecha_emision IS NOT NULL AND fecha_vencimiento IS NOT NULL)
  )
);

-- Agregar columnas faltantes si la tabla cits ya existia con estructura parcial
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='ciclista_id') THEN
    ALTER TABLE cits ADD COLUMN ciclista_id UUID NOT NULL DEFAULT gen_random_uuid();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='aliado_id') THEN
    ALTER TABLE cits ADD COLUMN aliado_id UUID NOT NULL DEFAULT gen_random_uuid();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='bicicleta_serial') THEN
    ALTER TABLE cits ADD COLUMN bicicleta_serial VARCHAR(120) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='huella_sha256') THEN
    ALTER TABLE cits ADD COLUMN huella_sha256 CHAR(64) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='firma_hmac') THEN
    ALTER TABLE cits ADD COLUMN firma_hmac VARCHAR(128) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='algoritmo') THEN
    ALTER TABLE cits ADD COLUMN algoritmo VARCHAR(60) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='snapshot_canonico') THEN
    ALTER TABLE cits ADD COLUMN snapshot_canonico TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cits' AND column_name='expira_en') THEN
    ALTER TABLE cits ADD COLUMN expira_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END
$$;

-- Indices
CREATE INDEX IF NOT EXISTS idx_cits_ciclista
  ON cits (ciclista_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cits_aliado
  ON cits (aliado_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cits_estado
  ON cits (estado);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_huella
  ON cits (huella_sha256);

-- Tabla cit_eventos
CREATE TABLE IF NOT EXISTS cit_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL REFERENCES cits (id),
  tipo VARCHAR(60) NOT NULL,
  estado_anterior cit_estado,
  estado_nuevo cit_estado,
  actor_id UUID,
  actor_rol VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cit_eventos_cit
  ON cit_eventos (cit_id, created_at ASC);
