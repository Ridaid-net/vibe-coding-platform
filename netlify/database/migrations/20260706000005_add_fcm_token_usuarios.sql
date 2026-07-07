-- RODAID · Agregar fcm_token a usuarios para push notifications Android
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fcm_token TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fcm_token_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_usuarios_fcm_token ON usuarios(fcm_token) WHERE fcm_token IS NOT NULL;
