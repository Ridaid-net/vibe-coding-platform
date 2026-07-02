-- ============================================================
-- RODAID — Hito 17 BYOD: Migración IoT físico → Cloud/Webhook
-- Strava / Garmin OAuth 2.0 + PostGIS para mapas de calor
-- ============================================================

-- Extensión geoespacial (requerida para GEOMETRY y funciones ST_*)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Tenants (multitenancia aislada)
CREATE TABLE IF NOT EXISTS tenants (
  id          VARCHAR(50) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar tenant por defecto RODAID
INSERT INTO tenants (id, name) VALUES ('rodaid', 'RODAID Mendoza')
  ON CONFLICT (id) DO NOTHING;

-- 2. Conexiones OAuth (reemplaza registro de hardware/IMEI)
CREATE TABLE IF NOT EXISTS oauth_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  tenant_id         VARCHAR(50) REFERENCES tenants(id) ON DELETE CASCADE,
  provider          VARCHAR(20) NOT NULL,        -- 'strava' | 'garmin'
  provider_user_id  VARCHAR(100) NOT NULL,        -- Athlete ID externo
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  expires_at        TIMESTAMP NOT NULL,
  scope             VARCHAR(200),
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT oauth_connections_provider_unique UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS oauth_connections_user_idx
  ON oauth_connections (user_id);

-- 3. Actividades con ruta geográfica (LineString GPS)
CREATE TABLE IF NOT EXISTS bike_activities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR(50) REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL,
  bicicleta_id         UUID REFERENCES bicicletas(id) ON DELETE SET NULL,
  activity_external_id VARCHAR(100) NOT NULL,    -- ID de actividad Strava/Garmin
  provider             VARCHAR(20) NOT NULL DEFAULT 'strava',
  distance_km          NUMERIC(8,2) NOT NULL,
  duration_seconds     INT NOT NULL,
  elevation_gain_m     NUMERIC(8,2),
  avg_speed_kmh        NUMERIC(6,2),
  geom                 GEOMETRY(LineString, 4326), -- Ruta GPS en coordenadas WGS84
  created_at           TIMESTAMP NOT NULL,
  synced_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bike_activities_external_unique UNIQUE (activity_external_id)
);

-- Índice espacial GIST (requerido para consultas de mapa de calor)
CREATE INDEX IF NOT EXISTS bike_activities_geom_idx
  ON bike_activities USING GIST (geom);

CREATE INDEX IF NOT EXISTS bike_activities_user_idx
  ON bike_activities (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bike_activities_tenant_idx
  ON bike_activities (tenant_id);

-- 4. Tabla de odómetro acumulado por bicicleta
CREATE TABLE IF NOT EXISTS bici_odometro (
  bicicleta_id     UUID PRIMARY KEY REFERENCES bicicletas(id) ON DELETE CASCADE,
  km_totales       NUMERIC(10,2) NOT NULL DEFAULT 0,
  ultima_actividad TIMESTAMP,
  ultima_alerta_km NUMERIC(10,2) DEFAULT 0,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
