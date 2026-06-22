-- ══════════════════════════════════════════════════════════
-- RODAID · Migración 007 — Auth Audit Log
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
  email       VARCHAR(255),
  evento      VARCHAR(60)  NOT NULL,  -- forgot_password, reset_password, login_ok, etc.
  resultado   VARCHAR(20)  NOT NULL DEFAULT 'ok', -- ok | fail | blocked
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_usuario
  ON auth_audit_log(usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_email
  ON auth_audit_log(email, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_evento
  ON auth_audit_log(evento, creado_en DESC);

-- Política de retención: auto-eliminar entradas > 90 días
-- (En producción usar pg_partman o una tarea cron)

GRANT ALL ON auth_audit_log TO rodaid_user;

-- ── Ampliar usuarios: reset cooldown ─────────────────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS reset_solicitado_en TIMESTAMPTZ;  -- cuándo se pidió el último reset

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'Migración 007 — Auth Audit Log';
  RAISE NOTICE 'Tabla: auth_audit_log';
  RAISE NOTICE 'Columna: reset_solicitado_en';
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
