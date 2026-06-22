-- ══════════════════════════════════════════════════════════
-- RODAID · Migración 006 — 2FA para Inspectores (TOTP)
-- ══════════════════════════════════════════════════════════

-- ── 1. Campos 2FA en usuarios ──────────────────────────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS totp_secret       TEXT,              -- secreto TOTP cifrado
  ADD COLUMN IF NOT EXISTS totp_habilitado   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_habilitado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_ultimo_uso   TIMESTAMPTZ;      -- anti-replay

-- ── 2. Tabla de códigos de respaldo (backup codes) ─────────
CREATE TABLE IF NOT EXISTS totp_backup_codes (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  code_hash   TEXT        NOT NULL,                             -- bcrypt hash del código
  usado       BOOLEAN     NOT NULL DEFAULT FALSE,
  usado_en    TIMESTAMPTZ,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_codes_usuario
  ON totp_backup_codes(usuario_id) WHERE NOT usado;

GRANT ALL ON totp_backup_codes TO rodaid_user;

-- ── 3. Tabla de tokens pre-auth (desafío 2FA) ─────────────
-- Se emite tras login exitoso cuando 2FA está activo.
-- El usuario lo canjea con el TOTP para obtener el JWT real.
CREATE TABLE IF NOT EXISTS preauth_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  usado       BOOLEAN     NOT NULL DEFAULT FALSE,
  ip_address  INET,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preauth_token_hash
  ON preauth_tokens(token_hash) WHERE NOT usado;

GRANT ALL ON preauth_tokens TO rodaid_user;

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'Migración 006 completada — 2FA TOTP';
  RAISE NOTICE 'Columnas: totp_secret, totp_habilitado, totp_ultimo_uso';
  RAISE NOTICE 'Tablas: totp_backup_codes, preauth_tokens';
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
