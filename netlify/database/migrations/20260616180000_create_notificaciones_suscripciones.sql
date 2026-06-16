-- RODAID — Hito 10: Notificaciones Push (arquitectura de eventos).
--
-- Mantiene al usuario informado del estado de su bici y de su actividad en el
-- marketplace mediante Web Push (notificaciones nativas del navegador). El
-- sistema es OPT-IN: el usuario debe autorizar explicitamente y suscribir su
-- navegador. Las suscripciones del navegador (endpoint + claves de cifrado de la
-- Web Push API) viven en `notificaciones_suscripciones`. Cada envio queda
-- asentado en `notificaciones_enviadas` para auditar y, a futuro, alimentar la
-- analitica de retencion.
--
-- El diseno es agnostico del canal: hoy el unico canal es 'webpush', pero la
-- bitacora de envios guarda `canal` para que sumar WhatsApp o Email mas adelante
-- (usando el mismo bus de eventos) no requiera tocar el esquema.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- notificaciones_suscripciones — suscripciones de Web Push por navegador.
--
-- Una fila por navegador/dispositivo (un usuario puede tener varias). El
-- `endpoint` es el identificador unico que entrega el navegador (push service);
-- `p256dh` y `auth` son las claves de cifrado del bloque `keys` de la Web Push
-- API (lo que el spec llama `auth_keys`), necesarias para cifrar el payload
-- (RFC 8291) de modo que solo ese navegador pueda leerlo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificaciones_suscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Endpoint del push service (FCM/Mozilla/WNS). Unico: re-suscribir el mismo
  -- navegador actualiza la fila en lugar de duplicarla.
  endpoint TEXT NOT NULL,
  -- Claves de cifrado de la suscripcion (Web Push API `subscription.keys`).
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_susc_endpoint
  ON notificaciones_suscripciones (endpoint);

CREATE INDEX IF NOT EXISTS idx_notif_susc_usuario
  ON notificaciones_suscripciones (usuario_id);

-- Reutiliza la funcion de touch de `usuarios` (Hito 1) para mantener
-- `updated_at` al dia en cada UPDATE (re-suscripcion del mismo endpoint).
DROP TRIGGER IF EXISTS trg_notif_susc_updated_at ON notificaciones_suscripciones;
CREATE TRIGGER trg_notif_susc_updated_at
  BEFORE UPDATE ON notificaciones_suscripciones
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- ---------------------------------------------------------------------------
-- notificaciones_enviadas — bitacora de notificaciones disparadas por eventos.
--
-- Una fila por intento de envio (best-effort). Sirve de auditoria y de base
-- para analitica de retencion. `evento` identifica el trigger de dominio
-- (p. ej. 'cit.aprobado', 'escrow.fondos_retenidos') y `canal` el medio
-- ('webpush' hoy; 'whatsapp'/'email' a futuro con el mismo bus de eventos).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificaciones_enviadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES usuarios (id) ON DELETE SET NULL,
  evento VARCHAR(60) NOT NULL,
  canal VARCHAR(30) NOT NULL DEFAULT 'webpush',
  titulo VARCHAR(160) NOT NULL,
  cuerpo TEXT NOT NULL,
  -- Cantidad de destinos (suscripciones) alcanzados con exito en este evento.
  entregas INTEGER NOT NULL DEFAULT 0,
  exito BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_env_usuario
  ON notificaciones_enviadas (usuario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_env_evento
  ON notificaciones_enviadas (evento, created_at DESC);
