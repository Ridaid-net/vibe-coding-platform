-- RODAID — Roles, RBAC, inspectores y talleres aliados.
--
-- Migración hacia adelante (NO modifica las migraciones ya aplicadas, que son
-- inmutables). Aporta la base de identidad y autorización sobre la que se apoyan
-- los endpoints de roles, la administración de inspectores/talleres y la emisión
-- de CITs (POST /cit/iniciar):
--
--   usuarios          → cuentas con un rol (CICLISTA, INSPECTOR, ALIADO, ADMIN)
--   talleres_aliados  → talleres habilitados que emiten CITs, con su propietario
--   inspectores       → técnicos certificados vinculados a un taller
--
-- También extiende `cits` con las columnas que la emisión por inspector necesita
-- (quién la emitió, en qué taller, puntos de inspección, hash y número de CIT),
-- sin tocar las columnas ni los datos existentes.

-- ── Usuarios ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  nombre          VARCHAR(160),
  rol             VARCHAR(20) NOT NULL DEFAULT 'CICLISTA'
                    CHECK (rol IN ('CICLISTA','INSPECTOR','ALIADO','ADMIN')),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios (rol);

-- ── Talleres aliados ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS talleres_aliados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(200) NOT NULL,
  direccion       VARCHAR(300),
  localidad       VARCHAR(120),
  provincia       VARCHAR(120) NOT NULL DEFAULT 'Mendoza',
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  telefono        VARCHAR(40),
  email           VARCHAR(255),
  descripcion     TEXT,
  plan_aliado     VARCHAR(20) NOT NULL DEFAULT 'base'
                    CHECK (plan_aliado IN ('base','estandar','premium')),
  propietario_id  UUID REFERENCES usuarios (id),
  habilitado      BOOLEAN NOT NULL DEFAULT TRUE,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_talleres_propietario
  ON talleres_aliados (propietario_id);

-- ── Inspectores ───────────────────────────────────────────
-- Un perfil de inspector por usuario; queda vinculado a un único taller.
CREATE TABLE IF NOT EXISTS inspectores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL UNIQUE REFERENCES usuarios (id),
  taller_aliado_id  UUID NOT NULL REFERENCES talleres_aliados (id),
  certificado       BOOLEAN NOT NULL DEFAULT FALSE,
  certificacion     VARCHAR(200),
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  habilitado_por    UUID REFERENCES usuarios (id),
  notas             TEXT,
  fecha_alta        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_baja        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inspectores_taller
  ON inspectores (taller_aliado_id);

-- ── Extensión de CITs para la emisión por inspector ───────
ALTER TABLE cits
  ADD COLUMN IF NOT EXISTS numero_cit        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS propietario_id    UUID,
  ADD COLUMN IF NOT EXISTS inspector_id      UUID REFERENCES inspectores (id),
  ADD COLUMN IF NOT EXISTS taller_aliado_id  UUID REFERENCES talleres_aliados (id),
  ADD COLUMN IF NOT EXISTS puntos            INTEGER,
  ADD COLUMN IF NOT EXISTS punto_detalle     JSONB,
  ADD COLUMN IF NOT EXISTS hash_sha256       VARCHAR(80),
  ADD COLUMN IF NOT EXISTS firma_inspector   TEXT,
  ADD COLUMN IF NOT EXISTS fotos             TEXT[],
  ADD COLUMN IF NOT EXISTS fecha_emision     TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_numero_cit
  ON cits (numero_cit) WHERE numero_cit IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cits_inspector ON cits (inspector_id);

-- ── Datos de demostración ─────────────────────────────────
-- Idempotente (IDs fijos + ON CONFLICT DO NOTHING). El ciclista demo
-- (20000000-…-0002) es el mismo `sub` que portan los JWT de RODAID y dueño de
-- los rodados sembrados en 20260612120000_seed_marketplace_demo.
INSERT INTO usuarios (id, email, nombre, rol) VALUES
  ('10000000-0000-0000-0000-000000000001', 'admin@rodaid.com.ar',     'Administración RODAID', 'ADMIN'),
  ('20000000-0000-0000-0000-000000000002', 'federico@rodaid.com.ar',  'Federico De Gea',       'CICLISTA'),
  ('20000000-0000-0000-0000-000000000003', 'andes@rodaid.com.ar',     'Andes Bikes — Taller',  'ALIADO'),
  ('20000000-0000-0000-0000-000000000004', 'inspector@rodaid.com.ar', 'Inspector Demo',        'INSPECTOR')
ON CONFLICT (id) DO NOTHING;

INSERT INTO talleres_aliados
  (id, nombre, direccion, localidad, provincia, telefono, email, descripcion, plan_aliado, propietario_id, habilitado) VALUES
  ('30000000-0000-0000-0000-000000000001',
   'Taller Andes Bikes',
   'Av. San Martín 1234',
   'Ciudad de Mendoza',
   'Mendoza',
   '+54 261 555-0100',
   'andes@rodaid.com.ar',
   'Taller aliado RODAID habilitado para emitir CITs según Ley 9556.',
   'estandar',
   '20000000-0000-0000-0000-000000000003',
   TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inspectores
  (id, usuario_id, taller_aliado_id, certificado, certificacion, activo, habilitado_por) VALUES
  ('70000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000004',
   '30000000-0000-0000-0000-000000000001',
   TRUE,
   'Certificación técnica RODAID · Ley 9556',
   TRUE,
   '10000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
