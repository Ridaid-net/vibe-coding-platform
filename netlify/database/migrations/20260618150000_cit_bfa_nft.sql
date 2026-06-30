-- RODAID — Modulo 4 (CIT): Configuracion Final · Acunacion del NFT en BFA.
--
-- Roll-forward sobre la capa CIT ya aplicada (20260606170000_create_cit_identidad).
-- Esa migracion es inmutable: ya creo `cits` con el sello criptografico, el estado
-- de anclaje (`bfa_estado`: NO_INICIADA / PENDIENTE / ACUNADO / ERROR), el txHash,
-- el stampId, el objetoId y el trigger de inmutabilidad. No se puede editar; se
-- corrige avanzando.
--
-- Hasta ahora el anclaje en la Blockchain Federal Argentina solo guardaba el txHash
-- de una confirmacion provista de forma externa. La acunacion del NFT necesita,
-- ademas, persistir la identidad del token y su metadata para que el certificado
-- quede representado on-chain de forma reproducible y verificable:
--
--   bfa_red            -- red/cadena destino del anclaje (etiqueta de configuracion)
--   bfa_token_id       -- identidad determinista del NFT (derivada de la huella)
--   bfa_metadata_hash  -- SHA-256 de la metadata canonica (ancla el contenido del token)
--   bfa_metadata       -- metadata ERC-721 del certificado (name, attributes, huella)
--   bfa_intentos       -- intentos de acunacion (para el barrido idempotente)
--   bfa_ultimo_error   -- ultimo error de submission (diagnostico; se limpia al acunar)
--
-- Todas las columnas son aditivas y nullable: ningun certificado existente cambia.
-- Ninguna esta en la lista protegida por `cit_proteger_payload`, de modo que la
-- evolucion del anclaje (PENDIENTE -> ACUNADO/ERROR) sigue permitida sin tocar los
-- datos sellados ni la huella, que permanecen inmutables.

ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_red VARCHAR(80);
ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_token_id VARCHAR(80);
ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_metadata_hash CHAR(64);
ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_metadata JSONB;
ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_intentos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_ultimo_error TEXT;

-- Estado de anclaje FALLIDO: la submission fallo por un error FATAL no recuperable
-- (rechazo del contrato: huella ya anclada, destino invalido, etc.), distinto de
-- ERROR, que es transitorio (red/timeout) y el barrido reintenta automaticamente.
-- Un FALLIDO no se reintenta solo: requiere re-acunacion manual del administrador.
-- ALTER TYPE ... ADD VALUE es aditivo e idempotente; no reescribe filas existentes.
ALTER TYPE cit_bfa_estado ADD VALUE IF NOT EXISTS 'FALLIDO';

-- Barrido de acunacion automatica: certificados vigentes que todavia no tienen un
-- NFT confirmado on-chain (nunca iniciados, preparados a la espera, o con error
-- transitorio recuperable). El worker programado los toma y los acuna de forma
-- idempotente. FALLIDO queda deliberadamente afuera (no se reintenta solo).
CREATE INDEX IF NOT EXISTS idx_cits_bfa_acunacion_pendiente
  ON cits (sellado_en)
  WHERE estado = 'ACTIVO'
    AND bfa_estado IN ('NO_INICIADA', 'PENDIENTE', 'ERROR');
