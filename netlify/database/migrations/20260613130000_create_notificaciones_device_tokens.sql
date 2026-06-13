-- RODAID — Modulo de Notificaciones.
-- Crea el soporte de envio de alertas push a los usuarios:
--   · device_tokens  → tokens de dispositivo (push) registrados por usuario
--   · notificaciones → bitacora de notificaciones generadas/enviadas
--
-- Los disparadores cubiertos son: CIT aprobado, CIT rechazado, alerta de robo
-- y vencimiento proximo del CIT. El vencimiento proximo lo detecta el arbol de
-- decision del CIT cuando un certificado entra en la zona de "menos de 60 dias"
-- (ver lib/cit.ts y src/services/notificaciones.service.ts).
--
-- No existe tabla `usuarios` en el esquema actual: el dueno de una bicicleta se
-- identifica por `bicicletas.propietario_id` (UUID libre). Por coherencia,
-- `device_tokens.usuario_id` y `notificaciones.usuario_id` son UUID sin FK.

-- ─── Tipos enumerados ──────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_plataforma') THEN
    CREATE TYPE device_plataforma AS ENUM (
      'IOS',
      'ANDROID',
      'WEB'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notificacion_tipo') THEN
    CREATE TYPE notificacion_tipo AS ENUM (
      'CIT_APROBADO',
      'CIT_RECHAZADO',
      'ALERTA_ROBO',
      'VENCIMIENTO_PROXIMO'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notificacion_estado') THEN
    CREATE TYPE notificacion_estado AS ENUM (
      'ENVIADA',
      'SIN_DISPOSITIVOS',
      'FALLIDA'
    );
  END IF;
END
$$;

-- ─── device_tokens ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  plataforma device_plataforma NOT NULL DEFAULT 'WEB',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para resolver rapidamente los destinos activos de un usuario al notificar.
CREATE INDEX IF NOT EXISTS idx_device_tokens_usuario_activo
  ON device_tokens (usuario_id)
  WHERE activo;

-- ─── notificaciones (bitacora) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  tipo notificacion_tipo NOT NULL,
  titulo VARCHAR(140) NOT NULL,
  cuerpo TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  cit_id UUID REFERENCES cits (id) ON DELETE CASCADE,
  bicicleta_id UUID REFERENCES bicicletas (id) ON DELETE CASCADE,
  estado notificacion_estado NOT NULL DEFAULT 'ENVIADA',
  dispositivos_alcanzados INTEGER NOT NULL DEFAULT 0 CHECK (dispositivos_alcanzados >= 0),
  leida_en TIMESTAMPTZ,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Listado del centro de notificaciones del usuario (mas recientes primero).
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario
  ON notificaciones (usuario_id, creada_en DESC);

-- Idempotencia del arbol de decision: una sola alerta de "proximo a vencer"
-- por CIT. El barrido inserta con ON CONFLICT DO NOTHING contra este indice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notificaciones_vencimiento_unico_por_cit
  ON notificaciones (cit_id)
  WHERE tipo = 'VENCIMIENTO_PROXIMO' AND cit_id IS NOT NULL;
