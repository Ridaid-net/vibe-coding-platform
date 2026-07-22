-- RODAID — "Iniciar Certificacion" desde el Panel del Taller Aliado.
--
-- Cuando un cliente llega a mostrador sin cuenta en RODAID, el taller carga
-- sus datos y los de la bici; el sistema crea la cuenta automaticamente (con
-- una contrasena aleatoria que nadie conoce, NUNCA expuesta) y le manda un
-- link para que el cliente "reclame" su cuenta y elija su propia contrasena.
-- `invitaciones_cuenta` guarda el token de ese link -- igual que el resto del
-- esquema, se guarda un hash del token, nunca el valor crudo (mismo criterio
-- que `sesiones.refresh_token_hash`).

CREATE TABLE IF NOT EXISTS invitaciones_cuenta (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios (id),
  token_hash VARCHAR(64) NOT NULL,
  expira_en  TIMESTAMPTZ NOT NULL,
  usado_en   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitaciones_cuenta_token_hash
  ON invitaciones_cuenta (token_hash);

-- Historial/soporte: todas las invitaciones emitidas para un usuario.
CREATE INDEX IF NOT EXISTS idx_invitaciones_cuenta_usuario
  ON invitaciones_cuenta (usuario_id, created_at DESC);
