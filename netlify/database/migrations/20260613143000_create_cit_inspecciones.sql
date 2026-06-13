-- RODAID — Modulo Inspector (CIT): Certificado de Inspeccion Tecnica.
--
-- Crea la base del flujo previo al Marketplace: el taller aliado y su inspector
-- registran los 20 puntos de control de una bicicleta y el resultado gatilla el
-- evento "CIT Aprobado" (estado ACTIVO) o "Rechazado" (estado RECHAZADO).
--
-- Un CIT ACTIVO y vigente es el requisito que habilita publicar en el Marketplace
-- (ver app/api/v1/marketplace/publicar): esta migracion provee las tablas
-- `bicicletas` y `cits` que ese flujo ya esperaba, mas el detalle de inspeccion.
--
-- Regla de aprobacion (Ley Provincial 9556, Art. 12): minimo 15 de 20 puntos.

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'PENDIENTE',
      'ACTIVO',
      'RECHAZADO',
      'VENCIDO'
    );
  END IF;
END
$$;

-- ── Talleres aliados ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS talleres_aliados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(120) NOT NULL,
  localidad VARCHAR(120),
  provincia VARCHAR(120) NOT NULL DEFAULT 'Mendoza',
  matricula VARCHAR(40),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bicicletas (rodados) ─────────────────────────────────────────────────────
-- propietario_id es el UUID del ciclista. No hay tabla de usuarios en este
-- servicio, por eso se guarda tambien el nombre para mostrar en la cola.

CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id UUID NOT NULL,
  propietario_nombre VARCHAR(120),
  numero_serie VARCHAR(100) NOT NULL UNIQUE,
  marca VARCHAR(100) NOT NULL,
  modelo VARCHAR(200) NOT NULL,
  anio SMALLINT CHECK (anio IS NULL OR anio BETWEEN 1980 AND 2031),
  tipo VARCHAR(40),
  color VARCHAR(80),
  fotos TEXT[] NOT NULL DEFAULT '{}',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id);

-- ── Numeracion del CIT: RCIT-YYYY-NNNNN ──────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS cit_numero_seq;

CREATE OR REPLACE FUNCTION next_numero_cit()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'RCIT-' || to_char(NOW(), 'YYYY') || '-' ||
         lpad(nextval('cit_numero_seq')::text, 5, '0');
$$;

-- ── CIT (Certificado de Inspeccion Tecnica) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_cit VARCHAR(30) NOT NULL UNIQUE,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE RESTRICT,
  propietario_id UUID NOT NULL,
  inspector_id UUID,
  inspector_nombre VARCHAR(120) NOT NULL,
  taller_aliado_id UUID REFERENCES talleres_aliados (id) ON DELETE SET NULL,
  estado cit_estado NOT NULL DEFAULT 'PENDIENTE',
  puntos SMALLINT NOT NULL DEFAULT 0 CHECK (puntos BETWEEN 0 AND 20),
  puntaje SMALLINT NOT NULL DEFAULT 0 CHECK (puntaje BETWEEN 0 AND 100),
  dj_firmada BOOLEAN NOT NULL DEFAULT FALSE,
  dj_firmada_en TIMESTAMPTZ,
  firma_inspector TEXT,
  motivo_rechazo TEXT,
  notas TEXT,
  fotos TEXT[] NOT NULL DEFAULT '{}',
  fecha_emision TIMESTAMPTZ,
  fecha_vencimiento TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un solo CIT vivo (ACTIVO o PENDIENTE) por bicicleta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_vivo_por_bicicleta
  ON cits (bicicleta_id)
  WHERE estado IN ('ACTIVO', 'PENDIENTE');

CREATE INDEX IF NOT EXISTS idx_cits_bicicleta
  ON cits (bicicleta_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_cits_estado_creado
  ON cits (estado, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_cits_taller
  ON cits (taller_aliado_id, creado_en DESC);

-- ── Detalle de los 20 puntos de control por CIT ──────────────────────────────

CREATE TABLE IF NOT EXISTS cit_puntos_control (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL REFERENCES cits (id) ON DELETE CASCADE,
  codigo VARCHAR(40) NOT NULL,
  categoria VARCHAR(40) NOT NULL,
  etiqueta VARCHAR(160) NOT NULL,
  peso SMALLINT NOT NULL DEFAULT 0,
  critico BOOLEAN NOT NULL DEFAULT FALSE,
  aprobado BOOLEAN NOT NULL DEFAULT FALSE,
  observacion TEXT,
  orden SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT cit_puntos_unico_por_cit UNIQUE (cit_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_cit_puntos_cit
  ON cit_puntos_control (cit_id, orden);

-- ── Audit trail de eventos del CIT ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cit_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL REFERENCES cits (id) ON DELETE CASCADE,
  tipo VARCHAR(60) NOT NULL,
  actor_id UUID,
  actor_rol VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cit_eventos_cit
  ON cit_eventos (cit_id, creado_en ASC);

-- ── Datos de referencia (talleres + cola inicial de rodados) ─────────────────
-- Solo se insertan si no existen, para que la pantalla del taller tenga datos
-- reales con los que operar. UUIDs fijos para idempotencia del seed.

INSERT INTO talleres_aliados (id, nombre, localidad, provincia, matricula) VALUES
  ('5b1f9c2e-0001-4a10-9b00-000000000001', 'Taller Bici San Martin', 'Ciudad de Mendoza', 'Mendoza', 'TA-MZA-0142'),
  ('5b1f9c2e-0001-4a10-9b00-000000000002', 'Rodados del Parque',     'Godoy Cruz',        'Mendoza', 'TA-MZA-0188'),
  ('5b1f9c2e-0001-4a10-9b00-000000000003', 'Cicleria Andina',        'Las Heras',         'Mendoza', 'TA-MZA-0210')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bicicletas (id, propietario_id, propietario_nombre, numero_serie, marca, modelo, anio, tipo, color) VALUES
  ('7c2a4d10-0002-4b20-8c00-000000000001', 'a1d4f0c2-1111-4111-8111-000000000011', 'Lucia Bordon',  'VR-XR85-7741',  'Vairo',       'XR 8.5',     2022, 'Mountain',  'Negro mate'),
  ('7c2a4d10-0002-4b20-8c00-000000000002', 'a1d4f0c2-1111-4111-8111-000000000012', 'Maxi Quiroga',  'TK-MRL7-1183',  'Trek',        'Marlin 7',   2021, 'Mountain',  'Rojo'),
  ('7c2a4d10-0002-4b20-8c00-000000000003', 'a1d4f0c2-1111-4111-8111-000000000013', 'Bruno Salinas', 'SP-SIR20-9054', 'Specialized', 'Sirrus 2.0', 2023, 'Urbana',    'Azul petroleo'),
  ('7c2a4d10-0002-4b20-8c00-000000000004', 'a1d4f0c2-1111-4111-8111-000000000014', 'Carla Funes',   'OL-FL20-3320',  'Olmo',        'Flash 2.0',  2020, 'Ruta',      'Blanco')
ON CONFLICT (id) DO NOTHING;
