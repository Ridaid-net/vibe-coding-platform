-- RODAID — Hito 7: Verificador Publico.
--
-- El verificador abierto (GET /api/v1/verificar/:serial) permite a cualquiera
-- consultar el estado de una bicicleta por su numero de serie o codigo CIT, sin
-- autenticacion. Esta migracion crea las dos tablas de soporte:
--
--   * logs_verificaciones  — bitacora ANONIMA de cada consulta, para analitica
--     de uso. NUNCA guarda datos personales: la IP se almacena solo como hash
--     (no se puede revertir al valor original). Permite detectar si una misma
--     serie esta siendo consultada repetidamente (posible interes en una
--     compra/venta puntual de una bici robada).
--
--   * rate_limit_verificaciones — contador por IP y ventana de tiempo para el
--     rate limiting estricto que protege al endpoint de ataques de fuerza bruta
--     sobre los numeros de serie (enumeracion).
--
-- Como la plataforma es serverless (Netlify) no hay un store en memoria
-- compartido entre invocaciones: tanto el rate limiting como la analitica viven
-- en Postgres (la base administrada por Netlify Database).
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- logs_verificaciones — bitacora anonima de consultas del verificador publico.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logs_verificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Termino consultado, normalizado (UPPER + sin espacios). Es el numero de
  -- serie o el codigo CIT; NO es un dato personal. Se guarda para poder agrupar
  -- y detectar consultas repetidas sobre la misma bici.
  consulta VARCHAR(120) NOT NULL,
  -- Como se interpreto la consulta: por numero de serie o por codigo CIT.
  tipo_busqueda VARCHAR(10) NOT NULL DEFAULT 'serial'
    CHECK (tipo_busqueda IN ('serial', 'cit')),

  -- Resultado de la consulta (para analitica). `encontrada` = hubo match.
  encontrada BOOLEAN NOT NULL DEFAULT FALSE,
  -- Veredicto semaforico devuelto: SEGURO | ROBADA | EN_VALIDACION |
  -- SIN_VERIFICAR | NO_ENCONTRADA. Texto libre acotado para no acoplar el enum
  -- de la app a la base.
  veredicto VARCHAR(20) NOT NULL DEFAULT 'NO_ENCONTRADA',

  -- Referencias opcionales a la bici/CIT halladas. Sirven para la analitica
  -- interna; NUNCA se exponen datos del propietario.
  bicicleta_id UUID REFERENCES bicicletas (id) ON DELETE SET NULL,
  cit_id UUID REFERENCES cits (id) ON DELETE SET NULL,

  -- ANONIMATO: hash de la IP del consultante (SHA-256 con sal del servidor). No
  -- se almacena la IP en claro. Permite contar/identificar comportamiento
  -- repetido sin guardar un identificador personal.
  ip_hash CHAR(64),
  -- User-Agent recortado (no es PII por si solo); util para distinguir bots.
  user_agent VARCHAR(200),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Analitica de "interes repetido": consultas sobre una misma serie en el tiempo.
CREATE INDEX IF NOT EXISTS idx_logs_verif_consulta
  ON logs_verificaciones (consulta, created_at DESC);

-- Barridos por ventana temporal (tendencias, limpieza).
CREATE INDEX IF NOT EXISTS idx_logs_verif_created
  ON logs_verificaciones (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_logs_verif_bicicleta
  ON logs_verificaciones (bicicleta_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- rate_limit_verificaciones — contador por IP y ventana (fixed-window).
-- ---------------------------------------------------------------------------
-- Clave (ip_hash, ventana_inicio): cada IP tiene un contador por ventana fija.
-- El endpoint hace un upsert atomico que incrementa el contador y rechaza
-- (HTTP 429) si supera el limite. Es resistente a la concurrencia porque el
-- incremento ocurre en una unica sentencia INSERT ... ON CONFLICT.
CREATE TABLE IF NOT EXISTS rate_limit_verificaciones (
  ip_hash CHAR(64) NOT NULL,
  ventana_inicio TIMESTAMPTZ NOT NULL,
  contador INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, ventana_inicio)
);

-- Limpieza de ventanas viejas.
CREATE INDEX IF NOT EXISTS idx_rate_limit_verif_ventana
  ON rate_limit_verificaciones (ventana_inicio);
