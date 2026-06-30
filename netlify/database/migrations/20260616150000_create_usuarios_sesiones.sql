-- RODAID — Hito 1: Autenticacion Definitiva.
--
-- Crea el sistema de usuarios y su capa de sesiones (refresh tokens), y conecta
-- las tablas de negocio ya existentes (`bicicletas`, `marketplace_publicaciones`)
-- con la nueva tabla `usuarios` mediante claves foraneas.
--
-- Diseno:
--   * `usuarios` es independiente pero EXTENSIBLE a proveedores externos (p. ej.
--     MxM): la columna `proveedor` distingue las cuentas locales (email +
--     password_hash) de las federadas (proveedor externo + `proveedor_uid`).
--     Una cuenta local SIEMPRE tiene password_hash; una federada NO lo necesita.
--   * `sesiones` guarda el RefreshToken (su hash SHA-256, nunca el valor crudo)
--     con su vencimiento. El AccessToken es de vida corta y no se persiste; el
--     RefreshToken es de vida larga y vive aqui para poder rotarse y revocarse.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- Rol del usuario dentro de RODAID.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'usuario_rol') THEN
    CREATE TYPE usuario_rol AS ENUM (
      'ciclista',   -- usuario final: publica y compra bicicletas
      'inspector',  -- peritaje / resolucion de validaciones y disputas
      'admin'       -- administracion de la plataforma
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(254) NOT NULL,
  -- Hash de la contrasena (scrypt, formato PHC). NULL para cuentas federadas
  -- que se autentican contra un proveedor externo y no tienen password propia.
  password_hash TEXT,
  rol usuario_rol NOT NULL DEFAULT 'ciclista',
  -- Datos de perfil flexibles (nombre, telefono, avatar, ciudad, etc.).
  datos_perfil JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Extensibilidad a proveedores externos (Hito futuro: MxM, Google, ...).
  -- 'local' = cuenta propia con email + contrasena. Cualquier otro valor
  -- identifica al proveedor federado; `proveedor_uid` guarda el id del usuario
  -- en ese proveedor.
  proveedor VARCHAR(30) NOT NULL DEFAULT 'local',
  proveedor_uid VARCHAR(255),
  email_verificado BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Integridad de credenciales: las cuentas locales exigen password_hash; las
  -- federadas exigen el identificador del proveedor.
  CONSTRAINT usuarios_credencial_valida CHECK (
    (proveedor = 'local' AND password_hash IS NOT NULL)
    OR (proveedor <> 'local' AND proveedor_uid IS NOT NULL)
  )
);

-- Email unico sin distinguir mayusculas/minusculas (se guarda ya en minusculas
-- desde la app, y el indice lo refuerza por las dudas).
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_lower
  ON usuarios (lower(email));

-- Identidad federada unica por proveedor (cuando aplica).
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_proveedor_uid
  ON usuarios (proveedor, proveedor_uid)
  WHERE proveedor_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_rol
  ON usuarios (rol);

-- Mantener actualizado `updated_at` en cada UPDATE.
CREATE OR REPLACE FUNCTION usuarios_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- ---------------------------------------------------------------------------
-- sesiones — RefreshTokens de larga duracion (rotacion + revocacion)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Hash SHA-256 (hex) del RefreshToken. NUNCA se guarda el token en claro: si
  -- la base se filtra, los tokens existentes no son utilizables.
  refresh_token_hash VARCHAR(64) NOT NULL,
  emitido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_en TIMESTAMPTZ NOT NULL,
  -- Revocacion: logout, rotacion o invalidacion forzada. Una sesion con
  -- `revocado_en` no es nula ya no sirve para refrescar.
  revocado_en TIMESTAMPTZ,
  -- Cadena de rotacion: al refrescar se emite una nueva sesion y la anterior se
  -- marca como reemplazada (deteccion de reuso de tokens robados).
  reemplazada_por UUID REFERENCES sesiones (id) ON DELETE SET NULL,
  user_agent TEXT,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_refresh_token_hash
  ON sesiones (refresh_token_hash);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario
  ON sesiones (usuario_id, created_at DESC);

-- Barrido de limpieza de sesiones vencidas/no revocadas.
CREATE INDEX IF NOT EXISTS idx_sesiones_expira
  ON sesiones (expira_en)
  WHERE revocado_en IS NULL;

-- ---------------------------------------------------------------------------
-- Claves foraneas hacia usuarios desde las tablas de negocio existentes.
--
-- Se agregan como NOT VALID: la restriccion queda activa y se aplica a TODA
-- escritura nueva (INSERT/UPDATE de la columna), garantizando integridad de aqui
-- en adelante, pero no re-escanea las filas ya presentes. Esto es deliberado:
-- las tablas pueden contener filas de demos previas cuyo propietario/vendedor no
-- corresponde a un usuario real; validar el historico romperia el deploy. El
-- camino seguro de roll-forward es enforcar a futuro y, si algun dia se limpia
-- el historico, ejecutar VALIDATE CONSTRAINT en una migracion posterior.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bicicletas_propietario_id_fkey'
  ) THEN
    ALTER TABLE bicicletas
      ADD CONSTRAINT bicicletas_propietario_id_fkey
      FOREIGN KEY (propietario_id) REFERENCES usuarios (id) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_publicaciones_vendedor_id_fkey'
  ) THEN
    ALTER TABLE marketplace_publicaciones
      ADD CONSTRAINT marketplace_publicaciones_vendedor_id_fkey
      FOREIGN KEY (vendedor_id) REFERENCES usuarios (id) NOT VALID;
  END IF;
END
$$;
