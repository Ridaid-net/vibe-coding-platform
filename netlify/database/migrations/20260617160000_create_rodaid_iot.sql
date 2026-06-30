-- RODAID — Hito 17: RODAID-IoT (telemetria, tiempo real y mantenimiento predictivo).
--
-- Construye el puente entre el hardware (sensores GPS / acelerometro vinculados a
-- una bicicleta) y el software. Cinco piezas de datos:
--
--   1) iot_dispositivos   — registro de cada dispositivo de telemetria, VINCULADO
--      al serial del cuadro y, por el, al CIT del usuario. Guarda el estado de
--      "bicicleta conectada": si el usuario ACTIVO la transmision en tiempo real
--      (opt-in expreso), el modo de bajo consumo, el nivel de bateria y la ultima
--      trama. Del secreto del dispositivo SOLO se guarda el hash (se muestra una
--      sola vez), igual que las API Keys del Hito 16.
--
--   2) telemetria_activa  — estado ACTUAL de cada bici conectada (una fila por
--      dispositivo, upsert). Campos del hito: serial, lat, lng, nivel_bateria,
--      acelerometro_data, timestamp. PRIVACIDAD/E2E: la posicion PRECISA (lat/lng)
--      jamas se guarda en claro; viaja cifrada extremo a extremo en
--      `posicion_cifrada` (AES-256-GCM, ver cifrado.service.ts) y solo el
--      propietario la descifra. Ademas se guarda el geo RECORTADO a barrio
--      (centro de celda) para usos no privilegiados, igual que el mapa de calor.
--
--   3) telemetria_historica — traza historica (para el mantenimiento predictivo y
--      el recorrido). ANONIMIZACION: a los 30 dias un barrido borra la posicion
--      precisa cifrada y deja solo el geo recortado a barrio, exactamente como el
--      mapa de calor (Hito 8/14). La traza vieja queda agregada y anonima.
--
--   4) iot_geovallas      — "zonas seguras" configuradas por el usuario. Si la bici
--      sale de una geovalla activa SIN autorizacion, el sistema dispara una alerta
--      push (Hito 10).
--
--   5) iot_alertas        — bitacora de alertas disparadas por la telemetria:
--      salida de geovalla, mantenimiento predictivo (cadena/cubiertas/servicio) y
--      robo en curso. Idempotente por `dedupe_key` para no spamear al usuario.
--
-- SEGURIDAD/PRIVACIDAD POR DISENO:
--   - El usuario es el UNICO que activa la transmision en tiempo real
--     (`transmision_activa`, opt-in expreso). Sin eso, no se ingesta posicion.
--   - La posicion precisa se cifra de extremo a extremo (AES-256-GCM); nunca en
--     claro. Los datos historicos se anonimizan a los 30 dias.
--   - No se persisten datos personales: la relacion es bici (serial) <-> dueño.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) iot_dispositivos — registro de dispositivos de telemetria.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iot_dispositivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Bici a la que esta vinculado el dispositivo (relacion con el bien). Borrar la
  -- bici elimina el dispositivo y toda su telemetria.
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  -- Dueño del dispositivo (el unico que puede activar la transmision y ver la
  -- ubicacion). FK logica a usuarios (NOT VALID), igual que el resto del proyecto.
  usuario_id UUID NOT NULL,
  -- Serial del cuadro CONGELADO al momento del vinculo: cada trama se valida
  -- contra este serial (el dispositivo esta atado al CIT del usuario).
  serial_normalizado VARCHAR(120) NOT NULL,

  -- Identificador publico del dispositivo (el "client_id" del hardware). Unico.
  device_uid VARCHAR(80) NOT NULL,
  -- Hash SHA-256 del secreto del dispositivo (HMAC de las tramas). El secreto en
  -- claro se muestra una sola vez al vincular; nunca se persiste.
  device_secret_hash CHAR(64) NOT NULL,

  nombre VARCHAR(120),

  -- Estado del dispositivo en el registro.
  --   'activo'    — operativo.
  --   'revocado'  — el usuario lo desvinculo (deja de aceptar tramas).
  estado VARCHAR(16) NOT NULL DEFAULT 'activo',

  -- OPT-IN EXPRESO: solo el usuario activa la transmision en tiempo real. Mientras
  -- este en FALSE, la ingesta rechaza la posicion (la bici no esta "conectada").
  transmision_activa BOOLEAN NOT NULL DEFAULT FALSE,

  -- Modo de bajo consumo: cuando el sensor lo permite, el backend prioriza una
  -- cadencia de reporte mas espaciada para que la bateria dure >= 6 meses.
  modo_bajo_consumo BOOLEAN NOT NULL DEFAULT TRUE,
  -- Cadencia de reporte sugerida (segundos) que el backend devuelve al dispositivo.
  intervalo_reporte_seg INTEGER NOT NULL DEFAULT 900,

  -- Ultimo nivel de bateria reportado (0..100) y momento de la ultima trama.
  nivel_bateria SMALLINT,
  ultima_trama_en TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT iot_dispositivos_estado_chk
    CHECK (estado IN ('activo', 'revocado')),
  CONSTRAINT iot_dispositivos_bateria_chk
    CHECK (nivel_bateria IS NULL OR (nivel_bateria >= 0 AND nivel_bateria <= 100)),
  CONSTRAINT iot_dispositivos_intervalo_chk
    CHECK (intervalo_reporte_seg >= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_iot_dispositivos_device_uid
  ON iot_dispositivos (device_uid);
CREATE INDEX IF NOT EXISTS idx_iot_dispositivos_bicicleta
  ON iot_dispositivos (bicicleta_id);
CREATE INDEX IF NOT EXISTS idx_iot_dispositivos_usuario
  ON iot_dispositivos (usuario_id);
CREATE INDEX IF NOT EXISTS idx_iot_dispositivos_serial
  ON iot_dispositivos (serial_normalizado);

-- FK logica a usuarios (enforca a futuro, no re-valida el historico).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'iot_dispositivos_usuario_id_fkey'
  ) THEN
    ALTER TABLE iot_dispositivos
      ADD CONSTRAINT iot_dispositivos_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_iot_dispositivos_updated_at ON iot_dispositivos;
CREATE TRIGGER trg_iot_dispositivos_updated_at
  BEFORE UPDATE ON iot_dispositivos
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) telemetria_activa — estado ACTUAL de la bici conectada (1 fila/dispositivo).
--    Campos del hito: serial, lat, lng, nivel_bateria, acelerometro_data,
--    timestamp. La posicion PRECISA (lat/lng) vive cifrada E2E en
--    `posicion_cifrada`; jamas en claro. El geo recortado (centro de celda) es lo
--    unico no cifrado, para usos agregados/no privilegiados.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetria_activa (
  -- Una sola fila por dispositivo: el estado "vivo". Upsert en cada trama.
  dispositivo_id UUID PRIMARY KEY
    REFERENCES iot_dispositivos (id) ON DELETE CASCADE,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL,
  -- Serial del cuadro (clave de la relacion con el bien).
  serial VARCHAR(120) NOT NULL,

  -- Posicion PRECISA cifrada extremo a extremo (AES-256-GCM). JSON {lat,lng,acc}.
  -- Solo el propietario la descifra (clave del servidor). NUNCA en claro.
  posicion_cifrada TEXT,
  -- Geo RECORTADO a barrio (centro de celda), igual que el mapa de calor: lo unico
  -- que puede usarse sin privilegios (analitica agregada). No revela direccion.
  geo_celda VARCHAR(32),
  geo_lat NUMERIC(8, 5),
  geo_lon NUMERIC(8, 5),
  geo_zona VARCHAR(120),
  geo_ciudad VARCHAR(120),

  -- Telemetria de estado.
  nivel_bateria SMALLINT,
  velocidad_kmh NUMERIC(6, 2),
  -- Datos del acelerometro (resumen de vibracion por eje / banda). JSONB flexible.
  acelerometro_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Marca temporal de la trama (la del dispositivo si la envia; si no, la de
  -- recepcion). Es el "timestamp" del hito.
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT telemetria_activa_bateria_chk
    CHECK (nivel_bateria IS NULL OR (nivel_bateria >= 0 AND nivel_bateria <= 100))
);

CREATE INDEX IF NOT EXISTS idx_telemetria_activa_bicicleta
  ON telemetria_activa (bicicleta_id);
CREATE INDEX IF NOT EXISTS idx_telemetria_activa_usuario
  ON telemetria_activa (usuario_id);

-- ---------------------------------------------------------------------------
-- 3) telemetria_historica — traza historica (recorrido + mantenimiento).
--    A los 30 dias un barrido borra `posicion_cifrada` y deja solo el geo
--    recortado: la traza vieja queda anonima y agregada como el mapa de calor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetria_historica (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispositivo_id UUID NOT NULL REFERENCES iot_dispositivos (id) ON DELETE CASCADE,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL,

  -- Posicion precisa cifrada E2E. Se PONE A NULL al anonimizar (>30 dias).
  posicion_cifrada TEXT,
  -- Geo recortado a barrio: persiste siempre (incluso tras anonimizar).
  geo_celda VARCHAR(32),
  geo_lat NUMERIC(8, 5),
  geo_lon NUMERIC(8, 5),
  geo_zona VARCHAR(120),
  geo_ciudad VARCHAR(120),

  nivel_bateria SMALLINT,
  velocidad_kmh NUMERIC(6, 2),
  acelerometro_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- true cuando ya se borro la posicion precisa (traza anonimizada).
  anonimizada BOOLEAN NOT NULL DEFAULT FALSE,

  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sostiene la consulta de traza por bici y el barrido de anonimizacion por fecha.
CREATE INDEX IF NOT EXISTS idx_telemetria_hist_bici_ts
  ON telemetria_historica (bicicleta_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetria_hist_dispositivo_ts
  ON telemetria_historica (dispositivo_id, ts DESC);
-- Indice parcial para el barrido de anonimizacion: solo filas aun NO anonimizadas.
CREATE INDEX IF NOT EXISTS idx_telemetria_hist_anonimizar
  ON telemetria_historica (created_at)
  WHERE anonimizada = FALSE;

-- ---------------------------------------------------------------------------
-- 4) iot_geovallas — "zonas seguras" configuradas por el usuario.
--    Geovalla circular (centro + radio). Si la bici sale de una geovalla ACTIVA
--    sin `autorizada_salida`, el sistema dispara una alerta push.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iot_geovallas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL,

  nombre VARCHAR(120) NOT NULL,
  -- Centro de la zona segura (lo define el dueño; es SU dato, no se expone a nadie).
  center_lat NUMERIC(9, 6) NOT NULL,
  center_lng NUMERIC(9, 6) NOT NULL,
  radio_m INTEGER NOT NULL,

  activa BOOLEAN NOT NULL DEFAULT TRUE,
  -- Autorizacion temporal de salida (el dueño "deja salir" la bici sin alertar).
  autorizada_salida BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT iot_geovallas_radio_chk CHECK (radio_m >= 25 AND radio_m <= 100000)
);

CREATE INDEX IF NOT EXISTS idx_iot_geovallas_bicicleta
  ON iot_geovallas (bicicleta_id);
CREATE INDEX IF NOT EXISTS idx_iot_geovallas_usuario
  ON iot_geovallas (usuario_id);

DROP TRIGGER IF EXISTS trg_iot_geovallas_updated_at ON iot_geovallas;
CREATE TRIGGER trg_iot_geovallas_updated_at
  BEFORE UPDATE ON iot_geovallas
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5) iot_alertas — alertas disparadas por la telemetria.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iot_alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispositivo_id UUID REFERENCES iot_dispositivos (id) ON DELETE SET NULL,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL,

  -- Tipo de alerta:
  --   'geovalla_salida'        — la bici salio de una zona segura sin autorizar.
  --   'mantenimiento_cadena'   — posible desgaste en cadena (acelerometro).
  --   'mantenimiento_cubiertas'— presion de cubiertas fuera de rango.
  --   'mantenimiento_servicio' — necesidad de servicio tecnico general.
  --   'robo_en_curso'          — robo reportado al Ministerio con ubicacion live.
  --   'bateria_baja'           — nivel de bateria critico del dispositivo.
  tipo VARCHAR(40) NOT NULL,
  severidad VARCHAR(16) NOT NULL DEFAULT 'media',  -- baja | media | alta | critica

  titulo VARCHAR(160) NOT NULL,
  mensaje VARCHAR(500) NOT NULL,

  -- Clave de deduplicacion: una alerta equivalente dentro de una ventana no se
  -- vuelve a crear (evita spamear al usuario). p.ej. "geovalla:<id>:<celda>".
  dedupe_key VARCHAR(200),

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconocida BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iot_alertas_usuario_fecha
  ON iot_alertas (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iot_alertas_bicicleta
  ON iot_alertas (bicicleta_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iot_alertas_tipo
  ON iot_alertas (tipo, created_at DESC);

-- Deduplicacion: a lo sumo UNA alerta por dedupe_key en una ventana de 6 horas.
-- Se implementa en el servicio (INSERT condicional) apoyado en este indice.
CREATE INDEX IF NOT EXISTS idx_iot_alertas_dedupe
  ON iot_alertas (dedupe_key, created_at DESC)
  WHERE dedupe_key IS NOT NULL;
