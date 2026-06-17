-- RODAID — Hito 19: Dashboard de Administracion (Operaciones y SysAdmin).
--
-- Da soporte al panel de administracion de escala provincial: monitoreo de
-- integridad, moderacion/auditoria, analitica de ecosistema y gestion de
-- identidades y roles. Restricciones del hito: MFA obligatoria, roles definidos
-- (SuperAdmin, Auditor, Operador de Soporte), bitacora INMUTABLE de cada accion
-- de modificacion con la identidad del administrador, y minimizacion de datos
-- personales (DNI/email solo cuando es estrictamente necesario para un proceso
-- de soporte oficial — y ese acceso queda auditado).
--
-- Piezas:
--   1) admin_perfiles      — sub-rol de administracion (superadmin/auditor/soporte)
--                            y enrolamiento MFA (TOTP). El secreto TOTP vive SOLO
--                            cifrado (AES-256-GCM); nunca en claro.
--   2) admin_bitacora      — bitacora INMUTABLE (append-only) de toda accion de
--                            modificacion del panel, con la identidad del admin,
--                            el recurso afectado y el detalle. Trigger + REVOKE.
--   3) inspector_licencias — licencia del inspector (Hito 11): numero, estado y
--                            vencimiento, gestionada desde el panel.
--   4) inspector_talleres  — talleres autorizados asignados a cada inspector.
--   5) usuarios.estado     — estado de la cuenta (activo/suspendido) para la
--                            moderacion del Marketplace.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) admin_perfiles — sub-rol de administracion + enrolamiento MFA.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_perfiles (
  -- Cuenta de usuario (debe tener rol 'admin' para operar el panel).
  usuario_id UUID PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,

  -- Sub-rol del panel:
  --   'superadmin' — control total (incluye gestion de roles).
  --   'auditor'    — solo lectura + bitacora (no ejecuta modificaciones).
  --   'soporte'    — moderacion / soporte (incluye acceso justificado a datos
  --                  personales para un proceso de soporte oficial).
  admin_rol VARCHAR(20) NOT NULL DEFAULT 'soporte'
    CHECK (admin_rol IN ('superadmin', 'auditor', 'soporte')),

  -- Enrolamiento MFA (TOTP, RFC 6238). El secreto vive SOLO cifrado.
  mfa_secret_cifrado TEXT,
  mfa_habilitado BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_confirmado_en TIMESTAMPTZ,

  creado_por UUID,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_perfiles_rol ON admin_perfiles (admin_rol);

CREATE OR REPLACE FUNCTION admin_perfiles_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_perfiles_updated_at ON admin_perfiles;
CREATE TRIGGER trg_admin_perfiles_updated_at
  BEFORE UPDATE ON admin_perfiles
  FOR EACH ROW
  EXECUTE FUNCTION admin_perfiles_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) admin_bitacora — bitacora INMUTABLE de las acciones del panel.
--    Toda accion de modificacion (ej. desbloquear un CIT, suspender una cuenta,
--    revocar una API Key, ver datos personales) queda asentada aqui con la
--    identidad del administrador que la ejecuto. No admite UPDATE ni DELETE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_bitacora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidad del administrador que ejecuto la accion.
  admin_id UUID NOT NULL,
  admin_rol VARCHAR(20) NOT NULL,

  -- Accion ejecutada (verbo estable, ej. 'denuncia.aprobar', 'cuenta.suspender',
  -- 'apikey.revocar', 'datos-personales.ver').
  accion VARCHAR(60) NOT NULL,
  -- Recurso afectado (tipo + id), para correlacionar la trazabilidad.
  recurso_tipo VARCHAR(40),
  recurso_id VARCHAR(120),

  -- Resultado: 'ok' | 'error' | 'denegado'.
  resultado VARCHAR(16) NOT NULL DEFAULT 'ok',

  -- Detalle no sensible de la accion (motivos, estado previo/nuevo, etc.).
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Hash de la IP de origen (no se guarda la IP en claro).
  ip_hash VARCHAR(64),
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_bitacora_admin
  ON admin_bitacora (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_bitacora_accion
  ON admin_bitacora (accion, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_bitacora_recurso
  ON admin_bitacora (recurso_tipo, recurso_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_bitacora_created
  ON admin_bitacora (created_at DESC);

-- INMUTABILIDAD: append-only. Un trigger BEFORE UPDATE/DELETE aborta cualquier
-- intento, de modo que la bitacora no se puede alterar ni borrar una vez escrita.
CREATE OR REPLACE FUNCTION admin_bitacora_inmutable()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_bitacora es append-only: no se permite %', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_bitacora_no_update ON admin_bitacora;
CREATE TRIGGER trg_admin_bitacora_no_update
  BEFORE UPDATE OR DELETE ON admin_bitacora
  FOR EACH ROW
  EXECUTE FUNCTION admin_bitacora_inmutable();

-- Defensa en profundidad: revoca el permiso a nivel de tabla.
REVOKE UPDATE, DELETE, TRUNCATE ON admin_bitacora FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) inspector_licencias — licencia del inspector (Hito 11), gestionada desde
--    el panel: numero, estado y vencimiento.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspector_licencias (
  inspector_id UUID PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,

  licencia_numero VARCHAR(60),
  -- 'activa' | 'suspendida' | 'vencida'.
  estado VARCHAR(20) NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'suspendida', 'vencida')),
  vence_en DATE,

  datos JSONB NOT NULL DEFAULT '{}'::jsonb,

  actualizado_por UUID,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_inspector_licencias_updated_at ON inspector_licencias;
CREATE TRIGGER trg_inspector_licencias_updated_at
  BEFORE UPDATE ON inspector_licencias
  FOR EACH ROW
  EXECUTE FUNCTION admin_perfiles_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4) inspector_talleres — talleres (aliados) autorizados a un inspector.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspector_talleres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id UUID NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  aliado_id UUID NOT NULL REFERENCES aliados (id) ON DELETE CASCADE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  asignado_por UUID,
  asignado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inspector_talleres_unico
  ON inspector_talleres (inspector_id, aliado_id);
CREATE INDEX IF NOT EXISTS idx_inspector_talleres_inspector
  ON inspector_talleres (inspector_id) WHERE activo;

-- ---------------------------------------------------------------------------
-- 5) usuarios.estado — estado de la cuenta para la moderacion del Marketplace.
--    'activo' | 'suspendido'. Una cuenta suspendida no opera el ecosistema.
-- ---------------------------------------------------------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'activo';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS suspendido_en TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS suspendido_motivo TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_estado_chk'
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_estado_chk CHECK (estado IN ('activo', 'suspendido'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_usuarios_estado ON usuarios (estado) WHERE estado <> 'activo';
