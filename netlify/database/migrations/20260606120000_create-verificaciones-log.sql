-- RODAID · Historial de verificaciones anónimas (analítica)
--
-- Registra cada consulta al Verificador Público de forma anónima, por diseño
-- (privacy by design): la IP cruda NUNCA se almacena, sólo un hash con salt
-- diario (ver lib/analytics.ts). Esta tabla alimenta el resumen de analítica.
--
-- Notas de privacidad:
--   · No existe columna para la IP cruda. Sólo `ip_hash` (16 hex, salt diario).
--   · El user-agent no se persiste; sólo se deriva `es_bot` para excluir bots
--     de las métricas humanas.

CREATE TABLE IF NOT EXISTS verificaciones_log (
  id          BIGSERIAL    PRIMARY KEY,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  serial      TEXT         NOT NULL,
  estado      TEXT         NOT NULL,
  encontrado  BOOLEAN      NOT NULL,
  origen      TEXT         NOT NULL DEFAULT 'WEB',
  -- Hash de IP con salt diario (16 hex). NULL si no se pudo derivar la IP.
  ip_hash     TEXT,
  -- Tráfico automatizado detectado por user-agent. Se excluye de las métricas
  -- humanas (tasaAcierto, unicosEstimados, porOrigen, topSeriales, etc.).
  es_bot      BOOLEAN      NOT NULL DEFAULT FALSE,
  duracion_ms INTEGER
);

-- Rango temporal: el resumen filtra siempre por ventana (1/7/30 días).
CREATE INDEX IF NOT EXISTS idx_verif_log_creado_en ON verificaciones_log (creado_en);

-- topSeriales: agrupa por serial dentro de la ventana.
CREATE INDEX IF NOT EXISTS idx_verif_log_serial ON verificaciones_log (creado_en, serial);
