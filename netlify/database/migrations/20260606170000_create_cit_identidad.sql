-- RODAID — Modulo 4: Certificacion de Identidad Tecnica (CIT).
--
-- Capa fundacional sobre la que se apoyan el Marketplace (Fase A) y RODAID PAY
-- (Fase B): el rodado (`bicicletas`) y su certificado tecnico (`cits`).
--
-- Flujo de inmutabilidad:
--   1. El aliado (taller) levanta la inspeccion de 20 puntos en el rodado y la
--      envia a POST /api/cit/iniciar.
--   2. En ese mismo instante se calcula una huella SHA-256 deterministica sobre
--      un snapshot canonico del payload y una firma HMAC-SHA256 de RODAID. Los
--      datos quedan INMUTABLES desde el intake (trigger `cit_proteger_payload`).
--   3. El certificado nace en PENDIENTE_VALIDACION con una ventana de 72 hs.
--      Tras la validacion de RODAID pasa a ACTIVO.
--   4. La huella es exactamente lo que luego se acuna en la Blockchain Federal
--      Argentina (BFA).

-- ── Catalogo del rodado ──────────────────────────────────────────────────────
-- marca/modelo son opcionales: en el intake puede llegar solo el numero de serie
-- y enriquecerse despues. El Marketplace tolera estos campos nulos.

CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id UUID NOT NULL,
  marca VARCHAR(80),
  modelo VARCHAR(80),
  anio INTEGER CHECK (anio IS NULL OR (anio >= 1900 AND anio <= 2100)),
  tipo VARCHAR(40),
  numero_serie VARCHAR(120) NOT NULL,
  numero_cuadro VARCHAR(120),
  color VARCHAR(40),
  rodado VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bicicletas_numero_serie_unico UNIQUE (numero_serie)
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id);

-- ── Estados del certificado y de la acunacion en BFA ─────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'PENDIENTE_VALIDACION',  -- intake recibido y sellado; en ventana de 72 hs
      'ACTIVO',                -- validado por RODAID; certificado vigente
      'VENCIDO',               -- expiro la ventana de 72 hs o la vigencia
      'REVOCADO'               -- anulado (robo, fraude, error de certificacion)
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_bfa_estado') THEN
    CREATE TYPE cit_bfa_estado AS ENUM (
      'NO_INICIADA',
      'PENDIENTE',  -- huella preparada, esperando confirmacion on-chain
      'ACUNADO',    -- anclado en la Blockchain Federal Argentina
      'ERROR'
    );
  END IF;
END
$$;

-- ── Certificado de Identidad Tecnica ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  ciclista_id UUID NOT NULL,            -- propietario del rodado
  aliado_id UUID NOT NULL,              -- taller que realiza la inspeccion
  aliado_nombre VARCHAR(160),
  estado cit_estado NOT NULL DEFAULT 'PENDIENTE_VALIDACION',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),

  -- Datos recopilados en el taller (inmutables desde el intake).
  bicicleta_serial VARCHAR(120) NOT NULL,
  inspeccion JSONB NOT NULL DEFAULT '[]'::jsonb,
  coordenadas_gps JSONB,
  fotos_hashes JSONB,
  alerta_gps BOOLEAN NOT NULL DEFAULT FALSE,

  -- Sello criptografico de inmutabilidad (se calcula en el intake).
  -- `snapshot_canonico` guarda la cadena JSON canonica EXACTA que se hasheo, de
  -- modo que la verificacion recalcule la huella byte a byte sin ambiguedad.
  huella_sha256 CHAR(64) NOT NULL,
  firma_hmac VARCHAR(128) NOT NULL,
  algoritmo VARCHAR(60) NOT NULL,
  snapshot_canonico TEXT NOT NULL,
  sellado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ventana del pipeline de validacion (intake + 72 hs).
  expira_en TIMESTAMPTZ NOT NULL,

  -- Vigencia del certificado (se fija al validar -> ACTIVO).
  validado_por UUID,
  validado_en TIMESTAMPTZ,
  fecha_emision TIMESTAMPTZ,
  fecha_vencimiento TIMESTAMPTZ,

  -- Anclaje en la Blockchain Federal Argentina (BFA).
  bfa_estado cit_bfa_estado NOT NULL DEFAULT 'NO_INICIADA',
  bfa_tx_hash VARCHAR(120),
  bfa_stamp_id VARCHAR(120),
  bfa_objeto_id VARCHAR(120),
  acunado_en TIMESTAMPTZ,

  -- Revocacion.
  revocacion_motivo TEXT,
  revocado_por UUID,
  revocado_en TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un CIT ACTIVO debe llevar su vigencia establecida.
  CONSTRAINT cits_activo_vigente CHECK (
    estado <> 'ACTIVO'
    OR (fecha_emision IS NOT NULL AND fecha_vencimiento IS NOT NULL)
  )
);

-- Como maximo un certificado "vivo" (en validacion o vigente) por rodado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_unico_vivo_por_bicicleta
  ON cits (bicicleta_id)
  WHERE estado IN ('PENDIENTE_VALIDACION', 'ACTIVO');

CREATE INDEX IF NOT EXISTS idx_cits_ciclista
  ON cits (ciclista_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cits_aliado
  ON cits (aliado_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cits_estado
  ON cits (estado);

-- Localiza un certificado por su huella (verificacion publica / BFA).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_huella
  ON cits (huella_sha256);

-- Barrido del pipeline: pendientes cuya ventana de 72 hs expiro.
CREATE INDEX IF NOT EXISTS idx_cits_pipeline_expira
  ON cits (expira_en)
  WHERE estado = 'PENDIENTE_VALIDACION';

-- Barrido de pendientes de anclaje on-chain.
CREATE INDEX IF NOT EXISTS idx_cits_bfa_pendiente
  ON cits (bfa_estado)
  WHERE bfa_estado = 'PENDIENTE';

-- ── Garantia de inmutabilidad a nivel base de datos ──────────────────────────
-- Los datos certificados y su sello quedan congelados desde el intake. Solo se
-- permite evolucionar el estado, la vigencia (al validar), el anclaje BFA, la
-- revocacion y la marca de tiempo.

CREATE OR REPLACE FUNCTION cit_proteger_payload()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.huella_sha256 IS DISTINCT FROM OLD.huella_sha256
     OR NEW.firma_hmac IS DISTINCT FROM OLD.firma_hmac
     OR NEW.algoritmo IS DISTINCT FROM OLD.algoritmo
     OR NEW.snapshot_canonico IS DISTINCT FROM OLD.snapshot_canonico
     OR NEW.bicicleta_serial IS DISTINCT FROM OLD.bicicleta_serial
     OR NEW.inspeccion IS DISTINCT FROM OLD.inspeccion
     OR NEW.coordenadas_gps IS DISTINCT FROM OLD.coordenadas_gps
     OR NEW.fotos_hashes IS DISTINCT FROM OLD.fotos_hashes
     OR NEW.alerta_gps IS DISTINCT FROM OLD.alerta_gps
     OR NEW.bicicleta_id IS DISTINCT FROM OLD.bicicleta_id
     OR NEW.ciclista_id IS DISTINCT FROM OLD.ciclista_id
     OR NEW.aliado_id IS DISTINCT FROM OLD.aliado_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.sellado_en IS DISTINCT FROM OLD.sellado_en
     OR NEW.expira_en IS DISTINCT FROM OLD.expira_en
  THEN
    RAISE EXCEPTION
      'CIT %: los datos certificados son inmutables desde el intake.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cit_proteger_payload ON cits;

CREATE TRIGGER trg_cit_proteger_payload
  BEFORE UPDATE ON cits
  FOR EACH ROW
  EXECUTE FUNCTION cit_proteger_payload();

-- ── Audit trail append-only del ciclo de vida del CIT ────────────────────────

CREATE TABLE IF NOT EXISTS cit_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL REFERENCES cits (id),
  tipo VARCHAR(60) NOT NULL,
  estado_anterior cit_estado,
  estado_nuevo cit_estado,
  actor_id UUID,
  actor_rol VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cit_eventos_cit
  ON cit_eventos (cit_id, created_at ASC);
