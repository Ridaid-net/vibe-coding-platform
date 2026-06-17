-- RODAID — Hito 18: Denuncia Ciudadana con Validacion de Documento Oficial (MPF).
--
-- Habilita la denuncia ciudadana de robo/hurto respaldada por el PDF oficial de
-- la denuncia realizada ante el Ministerio Publico Fiscal (MPF). Dos piezas:
--
--   1) denuncias_mpf — registro de cada denuncia con el documento oficial: el
--      estado del proceso, los datos extraidos del PDF (expediente + fecha), el
--      resultado del cruce con el titular verificado por MxM, la clave del PDF en
--      el bucket CIFRADO y la huella SHA-256 del PDF tal como se cargo.
--
--      Estado del proceso (`estado`):
--        - 'DENUNCIA_JUDICIAL_ACTIVA' — el PDF paso la validacion de estructura y
--          el cruce de titular: se desactiva el CIT, se bloquea el Marketplace y
--          se marca la incidencia en la Blockchain Federal Argentina (BFA).
--        - 'EN_REVISION' — el documento NO paso la validacion de estructura: la
--          denuncia queda en revision humana y NO bloquea nada automaticamente
--          (restriccion del hito).
--        - 'ANULADA' — anulada (p. ej. recupero / error).
--
--   2) denuncias_mpf_auditoria — bitacora INMUTABLE (append-only) de cada hecho
--      del proceso (carga, bloqueo, revision, acceso al documento por la
--      autoridad, aviso al Ministerio). GUARDA el hash SHA-256 del PDF del MPF
--      para garantizar que no fue alterado despues de la carga (restriccion del
--      hito). No admite UPDATE ni DELETE (trigger + REVOKE).
--
-- PRIVACIDAD POR DISENO: no se persiste el texto del documento ni datos
-- personales fuera de lo estrictamente necesario para la relacion con el bien y
-- la trazabilidad (expediente, fecha, banderas de coincidencia). El PDF vive solo
-- CIFRADO en reposo (AES-256-GCM) en Netlify Blobs; nunca en claro en la base.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) denuncias_mpf — denuncia ciudadana respaldada por el PDF del MPF.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS denuncias_mpf (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Bici denunciada y su CIT (la denuncia bloquea el CIT cuando se activa).
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  cit_id UUID REFERENCES cits (id) ON DELETE SET NULL,

  -- Testigo verificado: el usuario (propietario) con identidad gubernamental
  -- (MxM) que carga la denuncia. FK logica a usuarios (no estricta, igual que el
  -- resto del esquema, para no romper por filas de demos previas).
  usuario_id UUID NOT NULL,

  -- Numero de serie normalizado de la bici (clave de la relacion con el bien).
  serial_normalizado VARCHAR(120) NOT NULL,

  -- Estado del proceso de denuncia.
  estado VARCHAR(32) NOT NULL DEFAULT 'EN_REVISION'
    CHECK (estado IN ('DENUNCIA_JUDICIAL_ACTIVA', 'EN_REVISION', 'ANULADA')),

  -- Datos extraidos del PDF del MPF (NULL si no se pudieron extraer).
  numero_expediente VARCHAR(160),
  fecha_documento VARCHAR(40),

  -- Resultado del cruce automatico con el titular verificado por MxM.
  estructura_valida BOOLEAN NOT NULL DEFAULT FALSE,
  titular_coincide BOOLEAN NOT NULL DEFAULT FALSE,
  -- Detalle no sensible de la validacion (coincidencias, motivos, modo OCR).
  validacion JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- PDF del MPF en el bucket CIFRADO (clave del blob; el contenido viaja cifrado
  -- AES-256-GCM, nunca en claro).
  pdf_blob_key TEXT NOT NULL,
  -- Huella SHA-256 (hex) del PDF tal como se cargo: integridad / no alteracion.
  pdf_sha256 VARCHAR(64) NOT NULL,
  pdf_bytes INTEGER NOT NULL DEFAULT 0,

  -- Marca de 'incidencia' en la BFA (lock del NFT del CIT) al activarse.
  bfa_estado VARCHAR(24),
  bfa_tx_hash VARCHAR(120),

  -- Metadatos flexibles no sensibles.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_bicicleta
  ON denuncias_mpf (bicicleta_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_serial
  ON denuncias_mpf (serial_normalizado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_usuario
  ON denuncias_mpf (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_estado
  ON denuncias_mpf (estado);
-- A lo sumo una denuncia ACTIVA por bici (las EN_REVISION/ANULADA no cuentan).
CREATE UNIQUE INDEX IF NOT EXISTS idx_denuncias_mpf_activa_unica
  ON denuncias_mpf (bicicleta_id)
  WHERE estado = 'DENUNCIA_JUDICIAL_ACTIVA';

-- Mantener actualizado `actualizado_en` en cada UPDATE.
CREATE OR REPLACE FUNCTION denuncias_mpf_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_denuncias_mpf_updated_at ON denuncias_mpf;
CREATE TRIGGER trg_denuncias_mpf_updated_at
  BEFORE UPDATE ON denuncias_mpf
  FOR EACH ROW
  EXECUTE FUNCTION denuncias_mpf_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) denuncias_mpf_auditoria — bitacora INMUTABLE del proceso de denuncia.
--    Guarda el hash del PDF del MPF para garantizar que no fue alterado despues
--    de la carga (restriccion del hito).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS denuncias_mpf_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  denuncia_id UUID,
  bicicleta_id UUID,
  serial_normalizado VARCHAR(120),
  usuario_id UUID,

  -- Hecho auditado.
  --   'CARGA'                 — se cargo y proceso el PDF del MPF.
  --   'BLOQUEO'               — la denuncia paso a DENUNCIA_JUDICIAL_ACTIVA.
  --   'REVISION'              — el documento no valido y quedo EN_REVISION.
  --   'ACCESO_DOCUMENTO'      — la autoridad accedio al PDF via link seguro.
  --   'NOTIFICACION_MINISTERIO' — se notifico al Ministerio con el link al PDF.
  --   'ANULACION'             — la denuncia se anulo.
  evento VARCHAR(40) NOT NULL,

  -- Huella SHA-256 del PDF del MPF (no alteracion post-carga). El hash es lo que
  -- se asienta de forma inmutable; el PDF en si vive cifrado en el bucket.
  pdf_sha256 VARCHAR(64),

  -- Detalle no sensible (expediente, estado resultante, modo, identidad de quien
  -- accedio, etc.).
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_auditoria_denuncia
  ON denuncias_mpf_auditoria (denuncia_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_auditoria_serial
  ON denuncias_mpf_auditoria (serial_normalizado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_auditoria_evento
  ON denuncias_mpf_auditoria (evento, created_at DESC);

-- INMUTABILIDAD: append-only. Un trigger BEFORE UPDATE/DELETE aborta cualquier
-- intento (incluido el del owner), de modo que la bitacora —y el hash del PDF
-- que custodia— no se puede alterar ni borrar una vez escrita.
CREATE OR REPLACE FUNCTION denuncias_mpf_auditoria_inmutable()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'denuncias_mpf_auditoria es append-only: no se permite %', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_denuncias_mpf_auditoria_no_update ON denuncias_mpf_auditoria;
CREATE TRIGGER trg_denuncias_mpf_auditoria_no_update
  BEFORE UPDATE OR DELETE ON denuncias_mpf_auditoria
  FOR EACH ROW
  EXECUTE FUNCTION denuncias_mpf_auditoria_inmutable();

-- Defensa en profundidad: revoca el permiso a nivel de tabla.
REVOKE UPDATE, DELETE, TRUNCATE ON denuncias_mpf_auditoria FROM PUBLIC;
