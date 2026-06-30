-- RODAID — Hito 5: Pipeline de Validacion de 72hs.
--
-- Motor de verificacion automatica de identidad de la bicicleta (CIT). Cuando se
-- solicita un CIT, el cit_id se ENCOLA aqui; un worker espera la ventana de 72hs
-- (estado PENDIENTE con `inicio_en` + `ejecutar_en`) y luego ejecuta el
-- cross-reference contra la base del Ministerio de Seguridad (mock). Segun el
-- resultado, el CIT pasa a 'activo' (APROBADO) o 'bloqueado' (BLOQUEADO).
--
-- Como la plataforma es serverless (Netlify) no hay un proceso Bull/Redis vivo:
-- la cola se modela en Postgres y el worker corre como Netlify Scheduled Function
-- que barre los jobs vencidos. El patron es equivalente (delay -> `ejecutar_en`,
-- reintentos -> `intentos`/`proximo_intento_en`, dead-letter -> estado 'ERROR').
--
-- Roll-forward: no toca ninguna migracion ya aplicada.

-- Estado de un job de validacion en la cola.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'validacion_estado') THEN
    CREATE TYPE validacion_estado AS ENUM (
      'PENDIENTE',   -- encolado, esperando la ventana de 72hs
      'EN_PROCESO',  -- el worker lo esta procesando (claim transaccional)
      'APROBADO',    -- cross-reference limpio: CIT -> activo
      'BLOQUEADO',   -- cross-reference con alerta: CIT -> bloqueado
      'ERROR'        -- agoto los reintentos (dead-letter, requiere revision)
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- cola_validaciones — la "cola" de tareas de validacion.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cola_validaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL REFERENCES cits (id) ON DELETE CASCADE,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  estado validacion_estado NOT NULL DEFAULT 'PENDIENTE',

  -- Reloj de la ventana de 72hs (equivalente al delay de Bull).
  inicio_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- cuando se solicito la validacion
  ejecutar_en TIMESTAMPTZ NOT NULL,               -- inicio_en + ventana (no procesar antes)

  -- Reintentos idempotentes (equivalente a los attempts/backoff de Bull).
  intentos INTEGER NOT NULL DEFAULT 0,
  max_intentos INTEGER NOT NULL DEFAULT 5,
  proximo_intento_en TIMESTAMPTZ,                 -- backoff tras un fallo
  ultimo_error TEXT,

  -- Resultado del pipeline.
  resultado VARCHAR(20),                          -- 'APROBADO' | 'BLOQUEADO'
  hash_sha256 VARCHAR(64),                        -- huella del payload del CIT (Hito 4 / Blockchain)
  cross_reference_json JSONB,                     -- respuesta cruda del Ministerio (mock)
  procesado_en TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotencia de encolado: a lo sumo un job "vivo" por CIT. Reintentar el
-- encolado del mismo cit_id no duplica validaciones.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cola_val_unica_viva_por_cit
  ON cola_validaciones (cit_id)
  WHERE estado IN ('PENDIENTE', 'EN_PROCESO');

-- Barrido del worker: jobs PENDIENTE cuya ventana ya vencio y sin backoff activo.
CREATE INDEX IF NOT EXISTS idx_cola_val_due
  ON cola_validaciones (ejecutar_en)
  WHERE estado = 'PENDIENTE';

CREATE INDEX IF NOT EXISTS idx_cola_val_cit
  ON cola_validaciones (cit_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- log_validaciones — auditoria paso a paso del pipeline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_validaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cola_id UUID NOT NULL REFERENCES cola_validaciones (id) ON DELETE CASCADE,
  cit_id UUID NOT NULL,
  -- Paso del proceso: ENCOLADO, INICIO_PROCESAMIENTO, CROSS_REFERENCE_CONSULTADO,
  -- DECISION_APROBADO / DECISION_BLOQUEADO, HASH_CALCULADO, NOTIFICACION_ENVIADA,
  -- REINTENTO_PROGRAMADO, ERROR_FATAL, etc.
  paso VARCHAR(60) NOT NULL,
  detalle TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_val_cola
  ON log_validaciones (cola_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_log_val_cit
  ON log_validaciones (cit_id, created_at ASC);
