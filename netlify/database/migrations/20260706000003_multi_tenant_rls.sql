-- ============================================================
-- RODAID · Multi-Tenant Row-Level Security
-- Migración 20260706000003
-- Compatible con EDI X-Road Mendoza · Ley 25.326
-- ============================================================

-- 1. Tabla de inquilinos (tenants)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('plataforma', 'municipio', 'ministerio', 'mpf', 'organismo')),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Datos semilla de tenants
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
ALTER TABLE denuncias ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE salidas_grupales ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- 4. Asignar tenant rodaid a registros existentes
UPDATE usuarios SET tenant_id = (SELECT id FROM tenants WHERE slug = 'rodaid') WHERE tenant_id IS NULL;
UPDATE activos SET tenant_id = (SELECT id FROM tenants WHERE slug = 'rodaid') WHERE tenant_id IS NULL;
UPDATE denuncias SET tenant_id = (SELECT id FROM tenants WHERE slug = 'rodaid') WHERE tenant_id IS NULL;
UPDATE salidas_grupales SET tenant_id = (SELECT id FROM tenants WHERE slug = 'rodaid') WHERE tenant_id IS NULL;

-- 5. Activar Row-Level Security en tablas sensibles
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE activos ENABLE ROW LEVEL SECURITY;
ALTER TABLE denuncias ENABLE ROW LEVEL SECURITY;
ALTER TABLE salidas_grupales ENABLE ROW LEVEL SECURITY;

-- 6. Políticas RLS — acceso por tenant_id de sesión
CREATE POLICY usuarios_tenant_policy ON usuarios
  FOR ALL USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE POLICY activos_tenant_policy ON activos
  FOR ALL USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE POLICY denuncias_tenant_policy ON denuncias
  FOR ALL USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE POLICY salidas_grupales_tenant_policy ON salidas_grupales
  FOR ALL USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- 7. Índices para performance
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activos_tenant ON activos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_denuncias_tenant ON denuncias(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salidas_tenant ON salidas_grupales(tenant_id);

-- 8. Tabla de auditoría de acceso por tenant (cumple EDI X-Road)
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
