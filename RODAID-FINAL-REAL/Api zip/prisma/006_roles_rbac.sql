-- ═══════════════════════════════════════════════════════════
-- RODAID · Migración 006 — RBAC: permisos, invitaciones
-- ═══════════════════════════════════════════════════════════

-- ── 1. Tabla de permisos por rol ──────────────────────────
CREATE TABLE IF NOT EXISTS rol_permisos (
  rol     VARCHAR(20) NOT NULL CHECK (rol IN ('CICLISTA','INSPECTOR','ALIADO','ADMIN')),
  permiso VARCHAR(60) NOT NULL,
  PRIMARY KEY (rol, permiso)
);

-- ── 2. Completar columnas faltantes en talleres_aliados ───
ALTER TABLE talleres_aliados
  ADD COLUMN IF NOT EXISTS propietario_id UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS habilitado     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS telefono       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS email          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS descripcion    TEXT;

-- ── 3. Completar columnas faltantes en inspectores ────────
ALTER TABLE inspectores
  ADD COLUMN IF NOT EXISTS fecha_baja     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS habilitado_por UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS notas          TEXT,
  ADD COLUMN IF NOT EXISTS certificacion  VARCHAR(100);

-- ── 4. Tabla de invitaciones ──────────────────────────────
CREATE TABLE IF NOT EXISTS invitaciones (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  taller_id    UUID        NOT NULL REFERENCES talleres_aliados(id),
  invitado_por UUID        NOT NULL REFERENCES usuarios(id),
  email        VARCHAR(255) NOT NULL,
  token        VARCHAR(128) NOT NULL UNIQUE,
  rol_destino  VARCHAR(20) NOT NULL DEFAULT 'INSPECTOR',
  estado       VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
               CHECK (estado IN ('PENDIENTE','ACEPTADA','RECHAZADA','EXPIRADA')),
  expires_at   TIMESTAMPTZ NOT NULL,
  aceptada_por UUID        REFERENCES usuarios(id),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_taller    ON invitaciones(taller_id);
CREATE INDEX IF NOT EXISTS idx_inv_email     ON invitaciones(email, estado);
CREATE INDEX IF NOT EXISTS idx_inv_token     ON invitaciones(token);
CREATE INDEX IF NOT EXISTS idx_inv_pendiente ON invitaciones(estado, expires_at) WHERE estado='PENDIENTE';

-- ── 5. Matriz de permisos RODAID ──────────────────────────
-- Estrategia acumulativa: cada rol hereda los del anterior
-- CICLISTA (base) → INSPECTOR → ALIADO → ADMIN (todos)

TRUNCATE TABLE rol_permisos;

-- CICLISTA — operaciones sobre sus propios recursos
INSERT INTO rol_permisos VALUES
  ('CICLISTA','bici:read:own'),   ('CICLISTA','bici:write:own'),
  ('CICLISTA','cit:read:own'),    ('CICLISTA','mkt:read'),
  ('CICLISTA','mkt:publicar'),    ('CICLISTA','mkt:comprar'),
  ('CICLISTA','seg:denunciar'),   ('CICLISTA','seg:recuperar'),
  ('CICLISTA','seg:alertas:read'),('CICLISTA','usuario:read:own'),
  ('CICLISTA','usuario:write:own');

-- INSPECTOR — hereda CICLISTA + permisos de certificación
INSERT INTO rol_permisos VALUES
  ('INSPECTOR','bici:read:own'),   ('INSPECTOR','bici:write:own'),
  ('INSPECTOR','cit:read:own'),    ('INSPECTOR','mkt:read'),
  ('INSPECTOR','mkt:publicar'),    ('INSPECTOR','mkt:comprar'),
  ('INSPECTOR','seg:denunciar'),   ('INSPECTOR','seg:recuperar'),
  ('INSPECTOR','seg:alertas:read'),('INSPECTOR','usuario:read:own'),
  ('INSPECTOR','usuario:write:own'),
  -- específicos INSPECTOR
  ('INSPECTOR','cit:iniciar'),     ('INSPECTOR','cit:read:taller'),
  ('INSPECTOR','taller:read:own'), ('INSPECTOR','bici:read:all');

-- ALIADO — hereda INSPECTOR + gestión de taller
INSERT INTO rol_permisos VALUES
  ('ALIADO','bici:read:own'),    ('ALIADO','bici:write:own'),   ('ALIADO','bici:read:all'),
  ('ALIADO','cit:read:own'),     ('ALIADO','cit:iniciar'),      ('ALIADO','cit:read:taller'),
  ('ALIADO','mkt:read'),         ('ALIADO','mkt:publicar'),     ('ALIADO','mkt:comprar'),
  ('ALIADO','seg:denunciar'),    ('ALIADO','seg:recuperar'),    ('ALIADO','seg:alertas:read'),
  ('ALIADO','usuario:read:own'), ('ALIADO','usuario:write:own'),
  -- específicos ALIADO
  ('ALIADO','taller:read:own'),  ('ALIADO','taller:write:own'),
  ('ALIADO','inspector:manage:taller'), ('ALIADO','cit:read:taller');

-- ADMIN — todos los permisos
INSERT INTO rol_permisos VALUES
  ('ADMIN','bici:read:own'),      ('ADMIN','bici:write:own'),     ('ADMIN','bici:read:all'),
  ('ADMIN','cit:read:own'),       ('ADMIN','cit:iniciar'),        ('ADMIN','cit:validar'),
  ('ADMIN','cit:finalizar'),      ('ADMIN','cit:read:taller'),    ('ADMIN','cit:read:all'),
  ('ADMIN','cit:bloquear'),       ('ADMIN','mkt:read'),           ('ADMIN','mkt:publicar'),
  ('ADMIN','mkt:comprar'),        ('ADMIN','mkt:moderar'),
  ('ADMIN','seg:denunciar'),      ('ADMIN','seg:recuperar'),      ('ADMIN','seg:alertas:read'),
  ('ADMIN','seg:read:all'),       ('ADMIN','taller:read:own'),    ('ADMIN','taller:write:own'),
  ('ADMIN','taller:read:all'),    ('ADMIN','inspector:manage:taller'),
  ('ADMIN','inspector:read:all'), ('ADMIN','usuario:read:own'),   ('ADMIN','usuario:write:own'),
  ('ADMIN','usuario:read:all'),   ('ADMIN','usuario:role:change'),('ADMIN','usuario:deactivate'),
  ('ADMIN','admin:queue'),        ('ADMIN','admin:health'),       ('ADMIN','admin:rate_limits'),
  ('ADMIN','admin:tokens');

-- ── 6. Vincular admin@rodaid.com.ar como propietario del primer taller
UPDATE talleres_aliados
  SET propietario_id = (SELECT id FROM usuarios WHERE email='admin@rodaid.com.ar')
  WHERE propietario_id IS NULL AND nombre='Taller Andes Bikes';

-- ── 7. Grants
GRANT ALL ON rol_permisos, invitaciones TO rodaid_user;
GRANT ALL ON talleres_aliados TO rodaid_user;

DO $$
DECLARE perms INT;
BEGIN
  SELECT COUNT(*) INTO perms FROM rol_permisos;
  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'Migración 006 — RBAC completada';
  RAISE NOTICE 'Permisos cargados: % (%/4 roles)', perms, perms/4;
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
