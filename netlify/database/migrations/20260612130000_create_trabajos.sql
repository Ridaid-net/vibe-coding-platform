-- RODAID — Cola de trabajos diferidos (`trabajos`).
--
-- El backend de referencia (Express + BullMQ/Redis) resolvia su trabajo
-- diferido — validacion de CITs, expiracion de CITs vencidos y notificaciones —
-- con colas Bull respaldadas por Redis, y exponia endpoints de administracion
-- para ver el estado de cada cola y limpiar los jobs fallidos.
--
-- Netlify no ofrece Redis/BullMQ, asi que esa misma idea se modela aqui sobre
-- la base de datos: una tabla `trabajos` que actua como cola persistente con el
-- mismo ciclo de vida que Bull (waiting / active / completed / failed / delayed).
-- Los barridos de auto-release del escrow y la expiracion de CITs pasan a ser
-- trabajos encolados y reintentables, y la administracion (estado por cola y
-- limpieza de fallidos) se sirve desde estas filas.
--
-- Migracion puramente aditiva: no toca ninguna tabla existente.

CREATE TABLE IF NOT EXISTS trabajos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cola VARCHAR(40) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'waiting',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resultado JSONB,
  intentos INTEGER NOT NULL DEFAULT 0,
  max_intentos INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  disponible_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_en TIMESTAMPTZ,
  CONSTRAINT trabajos_estado_valido
    CHECK (estado IN ('waiting', 'active', 'completed', 'failed', 'delayed'))
);

-- Conteos por cola y estado (alimenta GET /admin/queue/stats).
CREATE INDEX IF NOT EXISTS idx_trabajos_cola_estado
  ON trabajos (cola, estado);

-- Reclamo de trabajos listos para ejecutarse y promocion de los demorados.
CREATE INDEX IF NOT EXISTS idx_trabajos_disponibles
  ON trabajos (estado, disponible_en);
