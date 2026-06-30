-- RODAID — Hito 11: Firma digital de actas (Web Crypto API / PKCS#12) + trazabilidad.
--
-- Eleva el acta de inspeccion fisica de una simple huella SHA-256 a un DOCUMENTO
-- TECNICO CON VALIDEZ LEGAL: cada acta queda firmada criptograficamente con la
-- clave privada de un certificado X.509 (cargado desde un bundle PKCS#12), usando
-- la Web Crypto API. La firma es verificable offline contra el certificado del
-- firmante, que viaja embebido en el acta.
--
-- Tambien refuerza la TRAZABILIDAD pedida por el Hito 11: cada validacion queda
-- asociada explicitamente a su `taller_id` (el aliado en cuyo contexto se hizo la
-- inspeccion) ademas del `inspector_id` que ya existia.
--
-- Esta migracion agrega a `inspecciones_fisicas`:
--   * taller_id            -> aliado (taller/tienda) bajo el que se firmo el acta.
--   * firma_algoritmo      -> algoritmo de la firma (p. ej. RSASSA-PKCS1-v1_5/SHA-256).
--   * firma_valor          -> firma digital (base64) sobre el payload canonico.
--   * firma_certificado    -> certificado X.509 del firmante (PEM) para verificar.
--   * firma_cert_serie     -> numero de serie del certificado firmante.
--   * firma_cert_fingerprint -> huella SHA-256 (hex) del certificado.
--   * firma_modo           -> 'PKCS12' (credencial real) o 'DEV' (efimera en preview).
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- Trazabilidad: taller (aliado) asociado a la validacion. NULL para una
-- inspeccion hecha por un perito global (inspector/admin) sin taller.
-- ---------------------------------------------------------------------------
ALTER TABLE inspecciones_fisicas
  ADD COLUMN IF NOT EXISTS taller_id UUID REFERENCES aliados (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inspecciones_taller
  ON inspecciones_fisicas (taller_id, created_at DESC);

-- Backfill: el taller de una inspeccion ya registrada es su aliado.
UPDATE inspecciones_fisicas
  SET taller_id = aliado_id
  WHERE taller_id IS NULL AND aliado_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Firma digital del acta (Web Crypto API / PKCS#12). Columnas nullable para no
-- romper las actas historicas (firmadas solo con la huella firma_hash).
-- ---------------------------------------------------------------------------
ALTER TABLE inspecciones_fisicas
  ADD COLUMN IF NOT EXISTS firma_algoritmo VARCHAR(48),
  ADD COLUMN IF NOT EXISTS firma_valor TEXT,
  ADD COLUMN IF NOT EXISTS firma_certificado TEXT,
  ADD COLUMN IF NOT EXISTS firma_cert_serie VARCHAR(80),
  ADD COLUMN IF NOT EXISTS firma_cert_fingerprint VARCHAR(95),
  ADD COLUMN IF NOT EXISTS firma_modo VARCHAR(16);
