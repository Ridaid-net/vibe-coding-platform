-- ═══════════════════════════════════════════════════════════
-- RODAID · Migración 005 — MxM OAuth Token Store & PKCE State
-- ═══════════════════════════════════════════════════════════

-- ── 1. Store de tokens MxM por usuario ────────────────────
CREATE TABLE IF NOT EXISTS mxm_tokens (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id       UUID        NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  access_token     TEXT        NOT NULL,
  refresh_token    TEXT,
  token_type       VARCHAR(20) NOT NULL DEFAULT 'Bearer',
  expires_at       TIMESTAMPTZ NOT NULL,
  scope            TEXT,
  cuil             VARCHAR(20),
  nivel            SMALLINT    NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 1 AND 2),
  -- Metadatos del token
  emitido_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mxm_tokens_usuario
  ON mxm_tokens(usuario_id);

CREATE INDEX IF NOT EXISTS idx_mxm_tokens_expires
  ON mxm_tokens(expires_at) WHERE expires_at > NOW();

-- ── 2. Store de state PKCE para prevención de CSRF ────────
CREATE TABLE IF NOT EXISTS mxm_oauth_state (
  state        VARCHAR(128) PRIMARY KEY,
  code_verifier TEXT,           -- PKCE code_verifier (S256)
  redirect_to  TEXT,            -- URL a la que redirigir post-login
  ip_address   INET,
  user_agent   TEXT,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  usado        BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_mxm_state_expires
  ON mxm_oauth_state(expires_at) WHERE NOT usado;

-- ── 3. Log de eventos OAuth (auditoría) ───────────────────
CREATE TABLE IF NOT EXISTS mxm_audit_log (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
  evento      VARCHAR(50) NOT NULL,    -- login_ok, login_fail, token_refresh, etc.
  cuil        VARCHAR(20),
  nivel       SMALLINT,
  ip_address  INET,
  user_agent  TEXT,
  error       TEXT,
  metadata    JSONB,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mxm_audit_usuario
  ON mxm_audit_log(usuario_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_mxm_audit_evento
  ON mxm_audit_log(evento, creado_en DESC);

-- ── 4. Ampliar usuarios con campos MxM adicionales ────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS mxm_sub              TEXT UNIQUE,   -- subject ID de MxM
  ADD COLUMN IF NOT EXISTS mxm_email            TEXT,          -- email en MxM (puede diferir)
  ADD COLUMN IF NOT EXISTS mxm_nivel_verificado SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mxm_ultimo_login     TIMESTAMPTZ;

-- ── 5. Grants de permisos ──────────────────────────────────
GRANT ALL ON mxm_tokens, mxm_oauth_state, mxm_audit_log TO rodaid_user;

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'Migración 005 completada — MxM OAuth Store';
  RAISE NOTICE 'Tablas: mxm_tokens, mxm_oauth_state, mxm_audit_log';
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
