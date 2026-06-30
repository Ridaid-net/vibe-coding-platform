-- RODAID — Hito 8: Mapa de Calor y Analitica de Seguridad.
--
-- Habilita el dashboard de inteligencia urbana: un mapa de calor ANONIMO y
-- AGREGADO de la actividad de seguridad sobre la ciudad (Mendoza). El motor de
-- analitica (src/services/analytics.service.ts) agrega dos senales:
--
--   * densidad de CONSULTAS del verificador publico (indice de "curiosidad"
--     sobre bicis en una zona), tomada de `logs_verificaciones`, y
--   * densidad de DENUNCIAS/discrepancias (puntos rojos), tomada de la nueva
--     tabla `discrepancias_reportadas`.
--
-- PRIVACIDAD POR DISENO (restriccion del hito):
--   - El mapa es estrictamente anonimo y agregado. NUNCA se guarda ni se expone
--     la ubicacion exacta de una bicicleta ni de un usuario.
--   - Tecnica de CLIPPING: la coordenada aproximada (derivada del geo de la
--     request, nivel ciudad) se RECORTA a una grilla de ~barrio/manzana antes de
--     persistirse. Solo se almacena el CENTRO de la celda (`geo_lat`/`geo_lon`)
--     y un identificador de celda (`geo_celda`), nunca la coordenada original.
--     Asi los datos jamas revelan una direccion puntual.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Geo recortado (clipped) en la bitacora de consultas del verificador.
--    Todas las columnas son NULLABLE: las filas historicas quedan sin geo y el
--    geo solo se completa de forma agregada/recortada de aqui en adelante.
-- ---------------------------------------------------------------------------
-- Identificador de celda de la grilla (no es una coordenada): "<latIdx>_<lonIdx>".
ALTER TABLE logs_verificaciones
  ADD COLUMN IF NOT EXISTS geo_celda VARCHAR(32);
-- Centro de la celda recortada (NO la coordenada exacta del consultante).
ALTER TABLE logs_verificaciones
  ADD COLUMN IF NOT EXISTS geo_lat NUMERIC(8, 5);
ALTER TABLE logs_verificaciones
  ADD COLUMN IF NOT EXISTS geo_lon NUMERIC(8, 5);
-- Etiquetas legibles para autoridades no tecnicas (ciudad / barrio-departamento).
ALTER TABLE logs_verificaciones
  ADD COLUMN IF NOT EXISTS geo_ciudad VARCHAR(120);
ALTER TABLE logs_verificaciones
  ADD COLUMN IF NOT EXISTS geo_zona VARCHAR(120);
-- true cuando la posicion fue SIMULADA (preview/sin geo real en la request),
-- para no confundir datos sinteticos con reales en la analitica.
ALTER TABLE logs_verificaciones
  ADD COLUMN IF NOT EXISTS geo_simulada BOOLEAN NOT NULL DEFAULT FALSE;

-- Agregacion del mapa de calor por celda y ventana temporal.
CREATE INDEX IF NOT EXISTS idx_logs_verif_geo_celda
  ON logs_verificaciones (geo_celda, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) discrepancias_reportadas — registro ANONIMO y AGREGADO de denuncias y
--    discrepancias geolocalizadas a nivel barrio (puntos rojos del mapa).
--
--    Una fila se crea cuando un inspector/aliado reporta una DISCREPANCIA en la
--    inspeccion fisica (Hito 11) o cuando se asienta una denuncia de robo. La
--    posicion se RECORTA igual que las consultas: solo el centro de la celda.
--    Las referencias a bicicleta/CIT/inspeccion son OPCIONALES y de uso interno;
--    el mapa nunca las expone (solo densidad por celda).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discrepancia_tipo') THEN
    CREATE TYPE discrepancia_tipo AS ENUM (
      'discrepancia',  -- los datos fisicos no coinciden (inspeccion presencial)
      'robo',          -- bici reportada como robada / CIT bloqueado
      'sospecha'       -- senal de actividad sospechosa detectada por analitica
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS discrepancias_reportadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo discrepancia_tipo NOT NULL DEFAULT 'discrepancia',

  -- Referencias internas OPCIONALES (nunca se exponen en el GeoJSON publico del
  -- dashboard). ON DELETE SET NULL para que borrar la bici no rompa la analitica.
  bicicleta_id UUID REFERENCES bicicletas (id) ON DELETE SET NULL,
  cit_id UUID REFERENCES cits (id) ON DELETE SET NULL,
  inspeccion_id UUID REFERENCES inspecciones_fisicas (id) ON DELETE SET NULL,

  -- Geo RECORTADO a nivel barrio/manzana (centro de celda, nunca el punto real).
  geo_celda VARCHAR(32),
  geo_lat NUMERIC(8, 5),
  geo_lon NUMERIC(8, 5),
  geo_ciudad VARCHAR(120),
  geo_zona VARCHAR(120),
  geo_simulada BOOLEAN NOT NULL DEFAULT FALSE,

  -- Detalle agregado (motivo recortado). NUNCA datos personales del propietario.
  detalle VARCHAR(300),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discrepancias_geo_celda
  ON discrepancias_reportadas (geo_celda, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discrepancias_created
  ON discrepancias_reportadas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discrepancias_tipo
  ON discrepancias_reportadas (tipo, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3) alertas_seguridad — "Puntos Calientes" detectados por el motor de
--    analitica: zonas donde el volumen de consultas de verificacion supera un
--    umbral critico en una ventana de tiempo. Cada fila es una alerta para el
--    equipo de seguridad. La posicion es la celda recortada (barrio), nunca un
--    punto exacto.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alerta_estado') THEN
    CREATE TYPE alerta_estado AS ENUM (
      'abierta',     -- alerta vigente, pendiente de revision del equipo
      'reconocida',  -- el equipo de seguridad la tomo
      'descartada'   -- falso positivo / resuelta
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alerta_severidad') THEN
    CREATE TYPE alerta_severidad AS ENUM ('media', 'alta', 'critica');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS alertas_seguridad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo VARCHAR(40) NOT NULL DEFAULT 'PUNTO_CALIENTE',

  -- Celda (barrio) donde se concentro la actividad.
  geo_celda VARCHAR(32) NOT NULL,
  geo_lat NUMERIC(8, 5),
  geo_lon NUMERIC(8, 5),
  geo_ciudad VARCHAR(120),
  geo_zona VARCHAR(120),

  -- Metricas de la deteccion.
  volumen INTEGER NOT NULL,            -- consultas observadas en la ventana
  umbral INTEGER NOT NULL,             -- umbral critico configurado
  ventana_horas INTEGER NOT NULL,      -- tamano de la ventana evaluada
  severidad alerta_severidad NOT NULL DEFAULT 'media',
  estado alerta_estado NOT NULL DEFAULT 'abierta',

  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  primera_deteccion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A lo sumo UNA alerta ABIERTA por celda: re-detectar el mismo punto caliente
-- actualiza la alerta existente en vez de duplicarla.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_celda_abierta
  ON alertas_seguridad (geo_celda)
  WHERE estado = 'abierta';

CREATE INDEX IF NOT EXISTS idx_alertas_estado
  ON alertas_seguridad (estado, created_at DESC);

-- Mantiene updated_at al dia (reutiliza la funcion creada en el Hito 1).
DROP TRIGGER IF EXISTS trg_alertas_seguridad_updated_at ON alertas_seguridad;
CREATE TRIGGER trg_alertas_seguridad_updated_at
  BEFORE UPDATE ON alertas_seguridad
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();
