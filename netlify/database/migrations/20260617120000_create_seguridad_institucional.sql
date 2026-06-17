-- RODAID — Hito 12: Integracion Institucional con el Ministerio de Seguridad.
--
-- Habilita el protocolo de intercambio de datos seguro entre RODAID y el
-- Ministerio de Seguridad. Tres piezas de datos:
--
--   1) ministerio_auditoria   — bitacora INMUTABLE (append-only) de cada consulta
--      cross-reference y de cada aviso de recupero recibido (quien / cuando / que
--      serial). NO admite UPDATE ni DELETE (trigger + REVOKE). El dato sensible
--      (DNI del propietario) se guarda CIFRADO en reposo (AES-256-GCM), nunca en
--      claro (ver src/services/cifrado.service.ts).
--
--   2) seguridad_alertas_cache — cache de lectura (read-through) del veredicto de
--      alerta por numero de serie, para cumplir el SLA < 2 s del cross-reference.
--      Materializa alerta_activa / tipo_alerta / expediente; se recomputa al
--      vencer el TTL o al invalidarse (recupero / bloqueo).
--
--   3) recuperos_ministerio   — eventos de recupero recibidos por el webhook
--      inverso. Idempotente por `evento_uid`. Localiza el CIT, lo desbloquea y
--      dispara la notificacion push (Hito 10). El payload sensible del Ministerio
--      se guarda CIFRADO en reposo.
--
-- PRIVACIDAD POR DISENO (restriccion del hito): no se persisten datos personales
-- fuera de la relacion estricta con la bicicleta. El DNI nunca se guarda en claro;
-- solo cifrado y/o como hash para correlacion. El serial es el unico identificador
-- en claro porque es la clave de la relacion con el bien.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) ministerio_auditoria — bitacora inmutable de la integracion institucional.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ministerio_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tipo de evento auditado.
  --   'CROSS_REFERENCE' — consulta del Ministerio sobre una bici.
  --   'RECUPERO'        — aviso de recupero recibido por el webhook inverso.
  --   'CROSS_REFERENCE_RECHAZADO' / 'RECUPERO_RECHAZADO' — peticion rechazada
  --   por mTLS (queda registrado el intento sin certificado valido).
  evento VARCHAR(40) NOT NULL,

  -- QUIEN: identidad del cliente mTLS (certificado de cliente validado contra la
  -- Autoridad Certificadora del Ministerio). NULL si la peticion fue rechazada.
  cliente_cn VARCHAR(200),
  cliente_serie VARCHAR(120),
  cliente_fingerprint VARCHAR(80),

  -- QUE: numero de serie del cuadro consultado (clave de la relacion con el bien).
  serial_consultado VARCHAR(120),

  -- Dato sensible recibido del Ministerio, CIFRADO en reposo (AES-256-GCM).
  -- Nunca se guarda el DNI en claro. NULL cuando no se recibio o no aplica.
  dni_cifrado TEXT,
  -- Hash del DNI (no reversible) para correlacionar consultas sin exponer el dato.
  dni_hash VARCHAR(64),

  -- RESULTADO devuelto / accion tomada.
  alerta_activa BOOLEAN,
  tipo_alerta VARCHAR(20),         -- 'robo' | 'discrepancia' | 'normal'
  expediente VARCHAR(120),

  -- Detalle no sensible (modo mTLS, motivo de rechazo, latencia, etc.).
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- CUANDO.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ministerio_auditoria_serial
  ON ministerio_auditoria (serial_consultado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ministerio_auditoria_evento
  ON ministerio_auditoria (evento, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ministerio_auditoria_created
  ON ministerio_auditoria (created_at DESC);

-- INMUTABILIDAD: la tabla es estrictamente append-only. Un trigger BEFORE
-- UPDATE/DELETE aborta cualquier intento (incluido el del owner), de modo que la
-- bitacora de auditoria no se puede alterar ni borrar una vez escrita.
CREATE OR REPLACE FUNCTION ministerio_auditoria_inmutable()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ministerio_auditoria es append-only: no se permite % ', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_ministerio_auditoria_no_update ON ministerio_auditoria;
CREATE TRIGGER trg_ministerio_auditoria_no_update
  BEFORE UPDATE OR DELETE ON ministerio_auditoria
  FOR EACH ROW
  EXECUTE FUNCTION ministerio_auditoria_inmutable();

-- Defensa en profundidad: revoca el permiso a nivel de tabla. El trigger es la
-- garantia dura; esto refuerza la intencion para cualquier rol que no sea owner.
REVOKE UPDATE, DELETE, TRUNCATE ON ministerio_auditoria FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2) seguridad_alertas_cache — cache read-through del veredicto por serial.
--    Acelera el cross-reference para cumplir el SLA < 2 s: la ruta caliente es
--    un lookup por PK (serial). Si la fila esta fresca (dentro del TTL) se sirve
--    tal cual; si falta o esta vencida, el servicio recomputa desde `cits` /
--    `discrepancias_reportadas` y hace upsert.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seguridad_alertas_cache (
  -- Numero de serie normalizado (mayusculas, solo [A-Z0-9]). Clave de la relacion
  -- con el bien y del cache.
  serial_normalizado VARCHAR(120) PRIMARY KEY,

  -- Referencias internas (uso interno; nunca se exponen al Ministerio).
  bicicleta_id UUID REFERENCES bicicletas (id) ON DELETE CASCADE,
  cit_id UUID REFERENCES cits (id) ON DELETE SET NULL,

  -- Veredicto materializado.
  alerta_activa BOOLEAN NOT NULL DEFAULT FALSE,
  tipo_alerta VARCHAR(20) NOT NULL DEFAULT 'normal',  -- robo | discrepancia | normal
  expediente VARCHAR(120),

  refrescado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seguridad_alertas_cache_refrescado
  ON seguridad_alertas_cache (refrescado_en);
CREATE INDEX IF NOT EXISTS idx_seguridad_alertas_cache_activa
  ON seguridad_alertas_cache (alerta_activa)
  WHERE alerta_activa = TRUE;

-- ---------------------------------------------------------------------------
-- 3) recuperos_ministerio — avisos de recupero recibidos del Ministerio.
--    El webhook inverso registra aqui cada aviso (idempotente por evento_uid),
--    localiza el CIT, lo desbloquea y dispara la notificacion al propietario.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recuperos_ministerio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificador unico del evento del Ministerio (idempotencia: reintentos del
  -- webhook no reprocesan ni re-notifican). Si el Ministerio no envia uno, el
  -- servicio deriva uno estable de (expediente|serial).
  evento_uid VARCHAR(160) NOT NULL UNIQUE,

  serial_normalizado VARCHAR(120) NOT NULL,
  bicicleta_id UUID REFERENCES bicicletas (id) ON DELETE SET NULL,
  cit_id UUID REFERENCES cits (id) ON DELETE SET NULL,
  expediente VARCHAR(120),

  -- Payload sensible recibido del Ministerio, CIFRADO en reposo (AES-256-GCM).
  payload_cifrado TEXT,

  -- Resultado del procesamiento del aviso.
  estado VARCHAR(24) NOT NULL DEFAULT 'PROCESADO',  -- PROCESADO | SIN_COINCIDENCIA
  desbloqueada BOOLEAN NOT NULL DEFAULT FALSE,
  notificado BOOLEAN NOT NULL DEFAULT FALSE,

  -- Identidad del cliente mTLS que envio el aviso (trazabilidad).
  cliente_cn VARCHAR(200),
  cliente_fingerprint VARCHAR(80),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recuperos_serial
  ON recuperos_ministerio (serial_normalizado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recuperos_created
  ON recuperos_ministerio (created_at DESC);
