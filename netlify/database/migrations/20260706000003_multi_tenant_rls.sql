-- ============================================================
-- RODAID · Multi-Tenant Row-Level Security v2
-- Migración 20260706000003
-- Compatible con EDI X-Road Mendoza · Ley 25.326
-- ============================================================

-- 1. Tabla de inquilinos (tenants) — con todas las columnas necesarias
DROP TABLE IF EXISTS tenants CASCADE;
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('plataforma', 'municipio', 'ministerio', 'mpf', 'organismo')),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Datos semilla
INSERT INTO tenants (slug, nombre, tipo) VALUES
  ('rodaid', 'RODAID — Plataforma Principal', 'plataforma'),
  ('ministerio_seguridad', 'Ministerio de Seguridad de Mendoza', 'ministerio'),
  ('mpf_mendoza', 'Ministerio Público Fiscal de Mendoza', 'mpf'),
  ('municipio_san_martin', 'Municipalidad de San Martín', 'municipio'),
  ('municipio_junin', 'Municipalidad de Junín', 'municipio'),
  ('municipio_rivadavia', 'Municipalidad de Rivadavia', 'municipio')
ON CONFLICT (slug) DO NOTHING;

-- 3. Agregar tenant_id a tablas sensibles
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE activos ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE salidas_grupales ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- 4. Asignar tenant rodaid a registros existentes
UPDATE usuarios SET tenant_id = (SELECT id FROM tenants WHERE slug = 'rodaid') WHERE tenant_id IS NULL;
UPDATE activos SET tenant_id = (SELECT id FROM tenants WHERE slug = 'rodaid') WHERE tenant_id IS NULL;
UPDATE salidas_grupales SET tenant_id = (SELECT id FROM tenants WHERE slug = 'rodaid') WHERE tenant_id IS NULL;

-- 5. Activar RLS
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE activos ENABLE ROW LEVEL SECURITY;
ALTER TABLE salidas_grupales ENABLE ROW LEVEL SECURITY;

-- 6. Políticas RLS
DROP POLICY IF EXISTS usuarios_tenant_policy ON usuarios;
CREATE POLICY usuarios_tenant_policy ON usuarios
  FOR ALL USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

DROP POLICY IF EXISTS activos_tenant_policy ON activos;
CREATE POLICY activos_tenant_policy ON activos
  FOR ALL USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

DROP POLICY IF EXISTS salidas_grupales_tenant_policy ON salidas_grupales;
CREATE POLICY salidas_grupales_tenant_policy ON salidas_grupales
  FOR ALL USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- 7. Índices
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activos_tenant ON activos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salidas_tenant ON salidas_grupales(tenant_id);

-- 8. Audit log EDI
CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  usuario_id UUID,
  accion TEXT NOT NULL,
  tabla TEXT,
  ip_origen TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_tenant ON tenant_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_created ON tenant_audit_log(created_at);
