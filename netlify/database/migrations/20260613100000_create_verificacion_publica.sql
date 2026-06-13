-- RODAID — Verificación pública de CITs + denuncias de robo y auditoría.
--
-- Migración hacia adelante (NO modifica las migraciones ya aplicadas, que son
-- inmutables). Es puramente aditiva: crea tablas nuevas y una vista, sin tocar
-- ninguna columna ni dato existente.
--
-- Aporta las piezas que la verificación pública por número de serie y la
-- validación previa a la emisión de un CIT necesitan para consultar la base de
-- datos real:
--
--   denuncias_robo       → denuncias de robo (alimenta tanto las alertas de la
--                          verificación pública como el check de denuncias del
--                          pipeline de validación de seriales)
--   verificaciones_log   → auditoría de cada consulta pública (serial, origen,
--                          IP, duración) para el panel de analytics admin
--   serial_validaciones  → auditoría de cada validación previa de serial, con
--                          el resultado y el detalle de los 7 checks
--   seriales_con_alertas → vista para el dashboard admin con las validaciones
--                          que arrojaron alertas

-- ── Denuncias de robo ─────────────────────────────────────
-- `numero_serie` se desnormaliza para poder cruzar por serie aunque la
-- bicicleta no esté registrada en RODAID.
CREATE TABLE IF NOT EXISTS denuncias_robo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id   UUID REFERENCES bicicletas (id),
  numero_serie   VARCHAR(120) NOT NULL,
  estado         VARCHAR(20) NOT NULL DEFAULT 'ACTIVA'
                   CHECK (estado IN ('ACTIVA','RESUELTA','ANULADA')),
  motivo         TEXT,
  denunciante_id UUID,
  localidad      VARCHAR(120),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_en    TIMESTAMPTZ
);

-- Búsqueda rápida de denuncias activas por serie (el cruce más frecuente).
CREATE INDEX IF NOT EXISTS idx_denuncias_serie_activa
  ON denuncias_robo (numero_serie)
  WHERE estado = 'ACTIVA';

CREATE INDEX IF NOT EXISTS idx_denuncias_bicicleta
  ON denuncias_robo (bicicleta_id);

-- ── Auditoría de verificaciones públicas ──────────────────
CREATE TABLE IF NOT EXISTS verificaciones_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial       VARCHAR(120),
  numero_cit   VARCHAR(40),
  encontrado   BOOLEAN NOT NULL DEFAULT FALSE,
  estado_cit   VARCHAR(30),
  origen       VARCHAR(10) NOT NULL DEFAULT 'API'
                 CHECK (origen IN ('API','WEB','APP','QR')),
  ip           VARCHAR(64),
  user_agent   TEXT,
  duracion_ms  INTEGER,
  desde_cache  BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verificaciones_creado
  ON verificaciones_log (creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_verificaciones_serial
  ON verificaciones_log (serial);

-- ── Auditoría de validaciones de serial (pre-CIT) ─────────
CREATE TABLE IF NOT EXISTS serial_validaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial          VARCHAR(120) NOT NULL,
  bicicleta_id    UUID REFERENCES bicicletas (id),
  propietario_dni VARCHAR(40),
  aprobado        BOOLEAN NOT NULL,
  tiene_alertas   BOOLEAN NOT NULL DEFAULT FALSE,
  resumen         TEXT,
  checks          JSONB NOT NULL DEFAULT '[]'::jsonb,
  inspector_id    UUID REFERENCES inspectores (id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_serial_validaciones_serial
  ON serial_validaciones (serial);

CREATE INDEX IF NOT EXISTS idx_serial_validaciones_creado
  ON serial_validaciones (creado_en DESC);

-- Vista para el dashboard admin: validaciones con alertas, más recientes primero.
CREATE OR REPLACE VIEW seriales_con_alertas AS
  SELECT id, serial, bicicleta_id, propietario_dni, aprobado, resumen, checks,
         inspector_id, creado_en
    FROM serial_validaciones
   WHERE tiene_alertas = TRUE
   ORDER BY creado_en DESC;
