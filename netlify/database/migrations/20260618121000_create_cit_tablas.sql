-- RODAID — Modulo 4 (parte 2/3): reemplazar tablas CIT con estructura completa.
--
-- La migracion 20260616120000_create_bicicletas_cits creo versiones primitivas
-- de bicicletas/cits/cit_estado. Esta migracion las reemplaza con la estructura
-- completa del modulo CIT fundacional. No hay datos reales que preservar.

-- Eliminar objetos de la version primitiva (CASCADE elimina dependencias)
DROP TABLE IF EXISTS cits CASCADE;
DROP TABLE IF EXISTS bicicletas CASCADE;
DROP TYPE IF EXISTS cit_estado CASCADE;
DROP TYPE IF EXISTS cit_bfa_estado CASCADE;

-- Recrear enum cit_estado completo con 7 estados en MAYUSCULAS
CREATE TYPE cit_estado AS ENUM (
  'PENDIENTE_VALIDACION',
  'PROCESANDO_CRUCE',
  'ANOMALIA_DETECTADA',
  'ACTIVO',
  'VENCIDO',
  'RECHAZADO',
  'REVOCADO'
);

-- Recrear enum cit_bfa_estado
CREATE TYPE cit_bfa_estado AS ENUM (
  'NO_INICIADA',
  'PENDIENTE',
  'ACUNADO',
  'ERROR'
);

-- Tabla bicicletas (estructura completa)
CREATE TABLE bicicletas (
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

CREATE INDEX idx_bicicletas_propietario ON bicicletas (propietario_id);

-- Tabla cits (estructura completa)
CREATE TABLE cits (
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

CREATE INDEX idx_cits_ciclista ON cits (ciclista_id, created_at DESC);
CREATE INDEX idx_cits_aliado ON cits (aliado_id, created_at DESC);
CREATE INDEX idx_cits_estado ON cits (estado);
CREATE UNIQUE INDEX idx_cits_huella ON cits (huella_sha256);

-- Tabla cit_eventos
CREATE TABLE cit_eventos (
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

CREATE INDEX idx_cit_eventos_cit ON cit_eventos (cit_id, created_at ASC);
