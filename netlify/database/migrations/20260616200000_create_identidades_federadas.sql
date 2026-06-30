-- RODAID — Hito 9: Integracion Institucional MxM (Mendoza por Mi).
--
-- Habilita la IDENTIDAD FEDERADA: un usuario puede autenticarse contra el IDP
-- del Gobierno de Mendoza (Mendoza por Mi, OIDC) ademas del login local
-- (email + contrasena), que se mantiene para casos de excepcion.
--
-- Diseno:
--   * `identidades_federadas` es la fuente de verdad del MAPEO entre una cuenta
--     de RODAID (`usuarios.id`) y la identidad de la persona en un proveedor
--     externo (`provider_id` + `external_uid`, el `sub` del IDP). Una cuenta
--     puede tener identidad LOCAL y federada a la vez (cuenta vinculada), por eso
--     el mapeo vive en su propia tabla y no solo en `usuarios.proveedor`.
--   * NUNCA se persiste el access_token del Gobierno: solo el identificador unico
--     de la persona (`external_uid`) y los datos oficiales necesarios para
--     pre-llenar el perfil (cuil, dni, nombre) en `datos_oficiales`.
--   * `usuarios.sello_gubernamental` marca el "check de verificado" especial: la
--     persona probo su identidad contra el Estado, lo que acelera su confianza.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- Sello gubernamental: la cuenta verifico su identidad contra el Estado (MxM).
-- Distinto de `email_verificado` (que solo prueba el control del email).
-- ---------------------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS sello_gubernamental BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- identidades_federadas — mapeo cuenta RODAID <-> identidad en un IDP externo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identidades_federadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cuenta de RODAID a la que pertenece esta identidad federada.
  user_id UUID NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Proveedor de identidad. Hoy 'mxm' (Mendoza por Mi); extensible a otros.
  provider_id VARCHAR(30) NOT NULL,
  -- Identificador unico e inmutable de la persona en ese proveedor (el `sub`
  -- del token OIDC). Es lo UNICO que se guarda del Gobierno para reconocerla;
  -- jamas se persiste el access_token.
  external_uid VARCHAR(255) NOT NULL,
  -- Momento en que el proveedor verifico la identidad (claim del token / ahora).
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Datos oficiales no sensibles para pre-llenar el perfil (cuil, dni, nombre).
  -- No incluye credenciales ni el token del Gobierno.
  datos_oficiales JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una identidad del proveedor mapea a EXACTAMENTE una cuenta de RODAID.
CREATE UNIQUE INDEX IF NOT EXISTS idx_identidades_federadas_provider_uid
  ON identidades_federadas (provider_id, external_uid);

-- Busqueda de las identidades federadas de una cuenta.
CREATE INDEX IF NOT EXISTS idx_identidades_federadas_user
  ON identidades_federadas (user_id);

-- Mantener `updated_at` al dia en cada UPDATE (reusa el helper de Hito 1 si
-- existe; si no, se crea uno local).
CREATE OR REPLACE FUNCTION identidades_federadas_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_identidades_federadas_updated_at ON identidades_federadas;
CREATE TRIGGER trg_identidades_federadas_updated_at
  BEFORE UPDATE ON identidades_federadas
  FOR EACH ROW
  EXECUTE FUNCTION identidades_federadas_touch_updated_at();
