-- ═══════════════════════════════════════════════════════════
-- RODAID · Migración 004 — JWT Sessions & Token Families
-- ═══════════════════════════════════════════════════════════

-- ── 1. Ampliar refresh_tokens con sesión y familia ─────────
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id    UUID         NOT NULL DEFAULT uuid_generate_v4(),
  ADD COLUMN IF NOT EXISTS device_info  JSONB,
  ADD COLUMN IF NOT EXISTS ip_address   INET,
  ADD COLUMN IF NOT EXISTS user_agent   TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ  DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS revoked      BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS revoked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT;

-- ── 2. Índices para detección de reúso y limpieza ─────────
CREATE INDEX IF NOT EXISTS idx_refresh_token_hash
  ON refresh_tokens(token);

CREATE INDEX IF NOT EXISTS idx_refresh_family
  ON refresh_tokens(family_id);

CREATE INDEX IF NOT EXISTS idx_refresh_revoked
  ON refresh_tokens(revoked) WHERE revoked = TRUE;

CREATE INDEX IF NOT EXISTS idx_refresh_active
  ON refresh_tokens(usuario_id, revoked, expires_at)
  WHERE revoked = FALSE;

-- ── 3. Token blacklist para access tokens por jti ─────────
-- Permite revocar access tokens individuales antes de que expiren
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti        UUID         PRIMARY KEY,
  usuario_id UUID         NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ  NOT NULL,
  reason     TEXT,
  creado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blacklist_jti
  ON token_blacklist(jti);

CREATE INDEX IF NOT EXISTS idx_blacklist_expires
  ON token_blacklist(expires_at);

-- Auto-limpieza: view para monitoreo de sesiones activas
CREATE OR REPLACE VIEW v_sesiones_activas AS
SELECT
  rt.id,
  rt.usuario_id,
  u.email,
  u.nombre,
  u.rol,
  rt.family_id,
  rt.ip_address::text,
  rt.user_agent,
  rt.device_info,
  rt.creado_en,
  rt.last_used_at,
  rt.expires_at
FROM refresh_tokens rt
JOIN usuarios u ON u.id = rt.usuario_id
WHERE rt.revoked = FALSE
  AND rt.expires_at > NOW()
ORDER BY rt.last_used_at DESC;

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'Migración 004 completada';
  RAISE NOTICE 'Nuevas columnas: family_id, device_info, ip_address, user_agent';
  RAISE NOTICE 'Nueva tabla: token_blacklist (access token revocation)';
  RAISE NOTICE 'Nueva vista: v_sesiones_activas';
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
