-- RODAID — Hito 15: RODAID-GPT (asistente experto en seguridad y gestion ciclista).
--
-- Crea la bitacora `gpt_consultas`, que cumple DOS funciones a la vez:
--
--   1. CUOTA MENSUAL (rate limiting): contar cuantas consultas REALES al modelo
--      hizo un usuario en el mes calendario en curso, para prevenir abusos y
--      acotar el costo de tokens. Los aciertos de cache no consumen cuota (no
--      cuestan tokens), pero igual se registran para tener la foto completa.
--
--   2. AUDITORIA respetuosa de la privacidad: queda el rastro de quien consulto
--      y cuando, SIN guardar jamas el texto de la pregunta. Solo se persiste un
--      hash SHA-256 de la pregunta normalizada (para medir repeticion / aciertos
--      de cache) y su longitud. Nunca se guardan datos personales ni el contenido
--      de la conversacion: eso vive, efimero, en la cache de Blobs.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

CREATE TABLE IF NOT EXISTS gpt_consultas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Autor de la consulta. FK logica a `usuarios` declarada NOT VALID, igual que
  -- el resto de las relaciones del proyecto: enforca a futuro sin re-escanear el
  -- historico (que puede tener filas de demos previas).
  usuario_id UUID NOT NULL,

  -- Hash SHA-256 (hex) de la pregunta NORMALIZADA. NUNCA se guarda el texto: el
  -- hash permite detectar repeticion y correlacionar con la cache sin exponer
  -- nada de lo que el usuario escribio.
  pregunta_hash CHAR(64) NOT NULL,
  -- Longitud de la pregunta (solo para analitica de uso; no revela contenido).
  pregunta_long INTEGER NOT NULL DEFAULT 0,

  -- Modelo efectivamente consultado (p. ej. claude-sonnet-4-6).
  modelo VARCHAR(80),

  -- true si la respuesta se sirvio desde la cache (no consumio tokens ni cuota).
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  -- true si el asistente se REHUSO a responder por falta de datos en el sistema
  -- (consejo legal/tecnico sin respaldo). Util para medir cobertura del dominio.
  rehusada BOOLEAN NOT NULL DEFAULT FALSE,

  -- Consumo de tokens reportado por el proveedor (NULL en aciertos de cache).
  tokens_entrada INTEGER,
  tokens_salida INTEGER,
  -- Latencia extremo a extremo de la consulta, en milisegundos.
  latencia_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK NOT VALID hacia usuarios (enforca a futuro, no re-valida el historico).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gpt_consultas_usuario_id_fkey'
  ) THEN
    ALTER TABLE gpt_consultas
      ADD CONSTRAINT gpt_consultas_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$$;

-- Indice que sostiene el conteo de cuota mensual por usuario: las consultas REALES
-- (cache_hit = FALSE) dentro del mes calendario en curso.
CREATE INDEX IF NOT EXISTS idx_gpt_consultas_usuario_fecha
  ON gpt_consultas (usuario_id, created_at DESC);

-- Indice parcial para acelerar el conteo de cuota (solo consultas que cuestan).
CREATE INDEX IF NOT EXISTS idx_gpt_consultas_cuota
  ON gpt_consultas (usuario_id, created_at)
  WHERE cache_hit = FALSE;
