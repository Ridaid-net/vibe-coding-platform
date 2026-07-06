-- RODAID · Tabla de webhooks gubernamentales
CREATE TABLE IF NOT EXISTS gov_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug TEXT NOT NULL,
  url TEXT NOT NULL,
  eventos TEXT[] DEFAULT ARRAY['DENUNCIA_ACTIVA', 'CIT_BLOQUEADO'],
  secret TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_slug, url)
);

CREATE INDEX IF NOT EXISTS idx_gov_webhooks_tenant ON gov_webhooks(tenant_slug);
CREATE INDEX IF NOT EXISTS idx_gov_webhooks_activo ON gov_webhooks(activo);
