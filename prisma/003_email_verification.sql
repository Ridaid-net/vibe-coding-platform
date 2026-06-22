-- ═══════════════════════════════════════════════════════════
-- RODAID · Migración 003 — Email Verification & Password Reset
-- ═══════════════════════════════════════════════════════════

-- ── 1. Campos de verificación de email ────────────────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email_verificado        BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verificado_en     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificacion_token      VARCHAR(128) UNIQUE,
  ADD COLUMN IF NOT EXISTS verificacion_expires_at TIMESTAMPTZ,

-- ── 2. Campos de reset de contraseña ──────────────────────
  ADD COLUMN IF NOT EXISTS reset_token             VARCHAR(128) UNIQUE,
  ADD COLUMN IF NOT EXISTS reset_expires_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultimo_cambio_password  TIMESTAMPTZ;

-- ── 3. Índices para lookups rápidos ───────────────────────
CREATE INDEX IF NOT EXISTS idx_usuarios_verificacion_token
  ON usuarios(verificacion_token) WHERE verificacion_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_reset_token
  ON usuarios(reset_token) WHERE reset_token IS NOT NULL;

-- ── 4. Los usuarios de MxM se consideran verificados ──────
-- (ya tienen identidad validada por el Gobierno de Mendoza)
UPDATE usuarios
  SET email_verificado = TRUE,
      email_verificado_en = NOW()
  WHERE mxm_verificado = TRUE AND email_verificado = FALSE;

-- ── 5. Seed users también verificados (desarrollo) ─────────
UPDATE usuarios
  SET email_verificado = TRUE,
      email_verificado_en = NOW()
  WHERE email IN (
    'federico@rodaid.com.ar',
    'inspector@taller-andes.com.ar',
    'admin@rodaid.com.ar'
  );

DO $$
DECLARE
  total   INT; verificados INT; sin_verif INT;
BEGIN
  SELECT COUNT(*) INTO total FROM usuarios;
  SELECT COUNT(*) INTO verificados FROM usuarios WHERE email_verificado = TRUE;
  sin_verif := total - verificados;
  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'Migración 003 completada';
  RAISE NOTICE 'Total usuarios : %', total;
  RAISE NOTICE 'Verificados    : %', verificados;
  RAISE NOTICE 'Sin verificar  : %', sin_verif;
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
