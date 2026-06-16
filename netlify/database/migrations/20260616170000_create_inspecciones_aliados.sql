-- RODAID — Hito 11: Portal de Inspectores y Aliados.
--
-- Habilita la VALIDACION PRESENCIAL delegada: un inspector verificado (o un
-- taller/tienda Aliado) revisa fisicamente la bicicleta y aprueba la inspeccion
-- o reporta una discrepancia. La aprobacion fisica actua como un ACELERADOR del
-- pipeline de 72hs (Hito 5): reduce la espera a 0 y dispara el anclaje en la BFA
-- de inmediato.
--
-- Esta migracion agrega:
--   * el rol 'aliado' al enum `usuario_rol` (talleres/tiendas con acceso acotado
--     al panel de inspecciones, solo para las bicis vinculadas a sus servicios),
--   * `usuarios.wallet_address`: la identidad digital del inspector. La aprobacion
--     queda vinculada a esta wallet (requisito del Hito 11),
--   * `aliados`: solicitudes de talleres/tiendas para ser Aliados (las aprueba un
--     admin),
--   * `aliado_servicios`: vinculo bici <-> aliado (bicis vendidas o mantenidas en
--     ese taller) que define el alcance de inspeccion de un aliado,
--   * `inspecciones_fisicas`: bitacora de auditoria de cada inspeccion presencial
--     (inspector_id, timestamp, wallet, firma del acta).
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- Rol 'aliado' (taller/tienda). Se suma al enum existente sin recrearlo.
-- No se usa el nuevo valor dentro de esta misma migracion (Postgres no permite
-- referenciar un valor de enum recien agregado en la misma transaccion).
-- ---------------------------------------------------------------------------
ALTER TYPE usuario_rol ADD VALUE IF NOT EXISTS 'aliado';

-- ---------------------------------------------------------------------------
-- Identidad digital del inspector: su wallet_address. La aprobacion de una
-- inspeccion queda firmada/vinculada a esta direccion. NULL hasta que el
-- inspector la configure en su perfil.
-- ---------------------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64);

-- ---------------------------------------------------------------------------
-- Enums de dominio del Hito 11.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aliado_estado') THEN
    CREATE TYPE aliado_estado AS ENUM (
      'pendiente',  -- solicitud enviada, esperando aprobacion del admin
      'aprobado',   -- aliado activo: puede inspeccionar sus bicis vinculadas
      'rechazado'   -- solicitud rechazada
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aliado_tipo') THEN
    CREATE TYPE aliado_tipo AS ENUM ('taller', 'tienda', 'otro');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inspeccion_resultado') THEN
    CREATE TYPE inspeccion_resultado AS ENUM (
      'APROBADA',     -- inspeccion fisica conforme: acelera el pipeline
      'DISCREPANCIA'  -- los datos fisicos no coinciden: frena la verificacion
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- aliados — talleres/tiendas que solicitan ser Aliados de RODAID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aliados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(160) NOT NULL,
  tipo aliado_tipo NOT NULL DEFAULT 'taller',
  email VARCHAR(254) NOT NULL,
  telefono VARCHAR(40),
  direccion TEXT,
  ciudad VARCHAR(120),
  cuit VARCHAR(20),
  estado aliado_estado NOT NULL DEFAULT 'pendiente',
  -- Cuenta de usuario duena del aliado (opcional al solicitar; cuando se aprueba
  -- y existe, su rol pasa a 'aliado' para acceder al panel de inspecciones).
  usuario_id UUID REFERENCES usuarios (id) ON DELETE SET NULL,
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,
  solicitado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_en TIMESTAMPTZ,
  resuelto_por UUID REFERENCES usuarios (id) ON DELETE SET NULL,
  motivo_rechazo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aliados_estado ON aliados (estado);
CREATE INDEX IF NOT EXISTS idx_aliados_usuario ON aliados (usuario_id);
CREATE INDEX IF NOT EXISTS idx_aliados_email_lower ON aliados (lower(email));

-- Reutiliza la funcion de touch de `usuarios` (creada en el Hito 1) para
-- mantener `updated_at` al dia en cada UPDATE.
DROP TRIGGER IF EXISTS trg_aliados_updated_at ON aliados;
CREATE TRIGGER trg_aliados_updated_at
  BEFORE UPDATE ON aliados
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- ---------------------------------------------------------------------------
-- aliado_servicios — vinculo bici <-> aliado. Define el ALCANCE de inspeccion
-- de un aliado: solo puede inspeccionar bicis que vendio o mantiene.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aliado_servicios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aliado_id UUID NOT NULL REFERENCES aliados (id) ON DELETE CASCADE,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  -- Naturaleza del vinculo: venta (bici vendida en el taller) o mantenimiento.
  tipo_servicio VARCHAR(30) NOT NULL DEFAULT 'mantenimiento',
  detalle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A lo sumo un vinculo por (aliado, bici): re-registrar el mismo servicio no
-- duplica el alcance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aliado_servicios_unico
  ON aliado_servicios (aliado_id, bicicleta_id);

CREATE INDEX IF NOT EXISTS idx_aliado_servicios_bici
  ON aliado_servicios (bicicleta_id);

-- ---------------------------------------------------------------------------
-- inspecciones_fisicas — bitacora de auditoria de las inspecciones presenciales.
-- Cada fila es un "acta": quien inspecciono (inspector_id), cuando (created_at),
-- con que identidad digital (inspector_wallet) y la firma del acta (firma_hash).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspecciones_fisicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL REFERENCES cits (id) ON DELETE CASCADE,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  -- Inspector que realizo la inspeccion (rol inspector o aliado).
  inspector_id UUID NOT NULL REFERENCES usuarios (id),
  -- Aliado (taller/tienda) en cuyo contexto se hizo la inspeccion, si aplica.
  aliado_id UUID REFERENCES aliados (id) ON DELETE SET NULL,
  resultado inspeccion_resultado NOT NULL,
  -- Identidad digital del inspector al momento de firmar (snapshot).
  inspector_wallet VARCHAR(64) NOT NULL,
  -- "Firma" del acta: SHA-256 del payload canonico de la inspeccion. Vincula la
  -- aprobacion a la identidad del inspector y es verificable.
  firma_hash VARCHAR(64) NOT NULL,
  notas TEXT,
  discrepancia_motivo TEXT,
  -- true si esta inspeccion redujo la espera del pipeline de 72hs a 0.
  acelero_pipeline BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspecciones_cit
  ON inspecciones_fisicas (cit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspecciones_bici
  ON inspecciones_fisicas (bicicleta_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspecciones_inspector
  ON inspecciones_fisicas (inspector_id, created_at DESC);
