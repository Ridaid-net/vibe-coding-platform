
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nombre VARCHAR(100),
  apellido VARCHAR(100),
  rol VARCHAR(20) DEFAULT 'CICLISTA',
  activo BOOLEAN DEFAULT TRUE,
  mxm_verificado BOOLEAN DEFAULT FALSE,
  mxm_nivel SMALLINT DEFAULT 0,
  cuil VARCHAR(20),
  wallet_address VARCHAR(42),
  plan_suscripcion VARCHAR(15) DEFAULT 'LIBRE',
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  tipo VARCHAR(30),
  titulo VARCHAR(200),
  cuerpo TEXT,
  datos JSONB,
  canal VARCHAR(20) DEFAULT 'IN_APP',
  leida BOOLEAN DEFAULT FALSE,
  leida_en TIMESTAMPTZ,
  enviada_mxm BOOLEAN DEFAULT FALSE,
  mxm_notif_id VARCHAR(100),
  mxm_tipo VARCHAR(40),
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  plataforma VARCHAR(15) NOT NULL,
  app_version VARCHAR(20),
  dispositivo VARCHAR(100),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_uso TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, token)
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_usuario ON fcm_tokens(usuario_id) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_token ON fcm_tokens(token) WHERE activo;

CREATE TABLE IF NOT EXISTS fcm_mensajes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID REFERENCES usuarios(id),
  notif_id UUID REFERENCES notificaciones(id),
  token_id UUID REFERENCES fcm_tokens(id),
  plataforma VARCHAR(15),
  titulo VARCHAR(200),
  cuerpo TEXT,
  datos_extra JSONB,
  topico VARCHAR(100),
  estado VARCHAR(15) NOT NULL DEFAULT 'ENVIADO',
  fcm_message_id VARCHAR(200),
  error_msg TEXT,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fcm_msg_usuario ON fcm_mensajes(usuario_id, enviado_en DESC);

-- Seed test users
INSERT INTO usuarios (id, email, nombre, apellido, rol) VALUES
  ('20000000-0000-0000-0000-000000000001', 'comprador@test.com', 'Juan', 'Test', 'CICLISTA'),
  ('20000000-0000-0000-0000-000000000002', 'vendedor@test.com', 'Federico', 'De Gea', 'CICLISTA')
ON CONFLICT DO NOTHING;
