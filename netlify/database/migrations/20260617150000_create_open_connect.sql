-- RODAID — Hito 16: RODAID Open-Connect.
--
-- Abre la plataforma al ecosistema externo SIN comprometer la seguridad ni la
-- privacidad. Todo lo que un tercero puede consumir es el ESTADO PUBLICO VERIFICADO
-- de una bicicleta (el mismo veredicto del Verificador Publico del Hito 7); nunca
-- datos personales del propietario. El acceso se gobierna con OAuth2 + PKCE y el
-- consentimiento EXPRESO del usuario.
--
-- Tablas que crea (roll-forward; no toca ninguna migracion ya aplicada):
--
--   1) developer_apps            — registro de aplicaciones de terceros (clientes
--      OAuth2 + API Key). Cada app pertenece a un usuario de RODAID (su dueño en
--      el portal de desarrolladores) y declara sus redirect_uris y scopes.
--   2) oauth_codes               — codigos de autorizacion de un solo uso (PKCE).
--      Se emiten tras el consentimiento del usuario y se canjean por un token.
--   3) oauth_tokens              — access tokens OPACOS (se guarda solo su hash).
--      Acotados a un scope y a UNA bicicleta consentida. Revocables.
--   4) developer_api_logs        — bitacora de uso por app (para el dashboard del
--      desarrollador: latencia, status, endpoint). Append-only.
--   5) developer_rate_limit      — contador fixed-window por app (rate limiting).
--   6) ecosystem_webhooks        — suscripciones de terceros a eventos PUBLICOS
--      (p. ej. cambio de estado de propiedad/identidad de una bici).
--   7) ecosystem_webhook_entregas— bitacora idempotente de entregas de webhooks.
--
-- Idempotente: usa IF NOT EXISTS / DO-blocks para poder reaplicarse sin error.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) developer_apps — aplicaciones de terceros (clientes OAuth2 + API Key)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS developer_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dueño de la app en el portal (un usuario de RODAID). FK logica NOT VALID,
  -- igual que el resto del proyecto.
  owner_usuario_id UUID NOT NULL,

  nombre VARCHAR(120) NOT NULL,
  descripcion TEXT,
  -- Sitio web del integrador (informativo, para la pantalla de consentimiento).
  sitio_url TEXT,

  -- Identidad del cliente OAuth2. `client_id` es publico; del secret y de la API
  -- key SOLO se guarda el hash (SHA-256) — el valor en claro se muestra UNA vez.
  client_id VARCHAR(64) NOT NULL,
  client_secret_hash CHAR(64) NOT NULL,
  -- Prefijo visible de la API Key (p. ej. "rdk_live_ab12") para identificarla en
  -- el panel sin exponer el secreto completo.
  api_key_prefix VARCHAR(32) NOT NULL,
  api_key_hash CHAR(64) NOT NULL,

  -- URIs de redireccion permitidas para el flujo de autorizacion (lista blanca).
  redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  -- Scopes que la app puede solicitar (subconjunto del catalogo del sistema).
  scopes TEXT[] NOT NULL DEFAULT '{}',

  -- 'sandbox' (pruebas) o 'produccion'. El sandbox permite a los devs ejercitar
  -- todo el flujo de punta a punta.
  entorno VARCHAR(20) NOT NULL DEFAULT 'sandbox',
  -- 'activa' | 'suspendida'. Una app suspendida no autoriza ni consume.
  estado VARCHAR(20) NOT NULL DEFAULT 'activa',
  -- Limite de requests por minuto del recurso publico (rate limiting).
  rate_limit_rpm INTEGER NOT NULL DEFAULT 120,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT developer_apps_entorno_chk CHECK (entorno IN ('sandbox', 'produccion')),
  CONSTRAINT developer_apps_estado_chk CHECK (estado IN ('activa', 'suspendida'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_developer_apps_client_id
  ON developer_apps (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_developer_apps_api_key_hash
  ON developer_apps (api_key_hash);
CREATE INDEX IF NOT EXISTS idx_developer_apps_owner
  ON developer_apps (owner_usuario_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'developer_apps_owner_fkey'
  ) THEN
    ALTER TABLE developer_apps
      ADD CONSTRAINT developer_apps_owner_fkey
      FOREIGN KEY (owner_usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) oauth_codes — codigos de autorizacion de un solo uso (PKCE)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Del codigo en claro solo se guarda el hash (SHA-256): se entrega una sola vez
  -- en la redireccion y se canjea por un token.
  code_hash CHAR(64) NOT NULL,

  app_id UUID NOT NULL,
  -- Usuario que dio el consentimiento (dueño de la bici).
  usuario_id UUID NOT NULL,
  -- Bicicleta cuyo estado publico se autoriza a compartir (alcance acotado).
  bicicleta_id UUID,

  scopes TEXT[] NOT NULL DEFAULT '{}',
  redirect_uri TEXT NOT NULL,

  -- PKCE: el desafio se guarda al autorizar; el verifier se comprueba al canjear.
  code_challenge VARCHAR(128),
  code_challenge_method VARCHAR(10),

  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_codes_hash ON oauth_codes (code_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_app ON oauth_codes (app_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 3) oauth_tokens — access tokens opacos (se guarda solo el hash). Revocables.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  token_hash CHAR(64) NOT NULL,

  app_id UUID NOT NULL,
  usuario_id UUID NOT NULL,
  -- Bicicleta consentida: el token SOLO puede leer el estado publico de esta bici.
  bicicleta_id UUID,

  scopes TEXT[] NOT NULL DEFAULT '{}',

  expira_en TIMESTAMPTZ NOT NULL,
  revocado_en TIMESTAMPTZ,
  ultimo_uso_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_hash ON oauth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_app ON oauth_tokens (app_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 4) developer_api_logs — bitacora de uso por app (dashboard del desarrollador)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS developer_api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  endpoint VARCHAR(160) NOT NULL,
  metodo VARCHAR(10) NOT NULL,
  status INTEGER NOT NULL,
  scope_usado VARCHAR(60),
  latencia_ms INTEGER,
  -- IP del consumidor SOLO como hash (no reversible), por privacidad.
  ip_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_developer_api_logs_app
  ON developer_api_logs (app_id, created_at DESC);

-- INMUTABILIDAD: la bitacora de uso es append-only. Un trigger aborta UPDATE/DELETE.
CREATE OR REPLACE FUNCTION developer_api_logs_inmutable()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'developer_api_logs es append-only: no se permite %', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_developer_api_logs_no_update ON developer_api_logs;
CREATE TRIGGER trg_developer_api_logs_no_update
  BEFORE UPDATE OR DELETE ON developer_api_logs
  FOR EACH ROW EXECUTE FUNCTION developer_api_logs_inmutable();

-- ───────────────────────────────────────────────────────────────────────────
-- 5) developer_rate_limit — contador fixed-window por app (rate limiting)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS developer_rate_limit (
  app_id UUID NOT NULL,
  ventana_inicio TIMESTAMPTZ NOT NULL,
  contador INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, ventana_inicio)
);

-- ───────────────────────────────────────────────────────────────────────────
-- 6) ecosystem_webhooks — suscripciones de terceros a eventos PUBLICOS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ecosystem_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,

  -- Endpoint del tercero al que se entregan los eventos (HTTPS recomendado).
  url TEXT NOT NULL,
  -- Eventos publicos a los que se suscribe (catalogo del sistema).
  eventos TEXT[] NOT NULL DEFAULT '{}',

  -- Secreto de firma HMAC-SHA256 (cabecera X-RODAID-Signature). Se entrega UNA vez
  -- al crear la suscripcion y se conserva para firmar cada entrega.
  secret VARCHAR(80) NOT NULL,

  estado VARCHAR(20) NOT NULL DEFAULT 'activo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ecosystem_webhooks_estado_chk CHECK (estado IN ('activo', 'pausado'))
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_webhooks_app
  ON ecosystem_webhooks (app_id, created_at DESC);
-- Indice GIN para resolver rapido "que suscripciones escuchan este evento".
CREATE INDEX IF NOT EXISTS idx_ecosystem_webhooks_eventos
  ON ecosystem_webhooks USING GIN (eventos);

-- ───────────────────────────────────────────────────────────────────────────
-- 7) ecosystem_webhook_entregas — bitacora idempotente de entregas
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ecosystem_webhook_entregas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL,
  -- Identificador unico del evento (idempotencia: una entrega por (webhook, evento)).
  evento_id UUID NOT NULL,
  evento_tipo VARCHAR(60) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code INTEGER,
  exito BOOLEAN NOT NULL DEFAULT FALSE,
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entregado_en TIMESTAMPTZ
);

-- Idempotencia: una sola entrega por (suscripcion, evento).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ecosystem_entregas_idem
  ON ecosystem_webhook_entregas (webhook_id, evento_id);
CREATE INDEX IF NOT EXISTS idx_ecosystem_entregas_webhook
  ON ecosystem_webhook_entregas (webhook_id, created_at DESC);

-- updated_at automatico (reutiliza la funcion comun del proyecto si existe).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'usuarios_touch_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS trg_developer_apps_updated_at ON developer_apps;
    CREATE TRIGGER trg_developer_apps_updated_at
      BEFORE UPDATE ON developer_apps
      FOR EACH ROW EXECUTE FUNCTION usuarios_touch_updated_at();

    DROP TRIGGER IF EXISTS trg_ecosystem_webhooks_updated_at ON ecosystem_webhooks;
    CREATE TRIGGER trg_ecosystem_webhooks_updated_at
      BEFORE UPDATE ON ecosystem_webhooks
      FOR EACH ROW EXECUTE FUNCTION usuarios_touch_updated_at();
  END IF;
END
$$;
