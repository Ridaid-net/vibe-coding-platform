-- RODAID — Hito 4: Anclaje de Identidad en la BFA (Blockchain Federal Argentina).
--
-- Cuando el pipeline de validacion (Hito 5) aprueba un CIT y calcula su huella
-- SHA-256, el backend ancla esa identidad en la BFA minteando un NFT (ERC-721,
-- contrato `RodaidCIT.sol`). Esta migracion agrega a `cits` las columnas que
-- guardan el resultado de ese anclaje on-chain: el `tx_hash` de la transaccion,
-- el tokenId minteado y el estado del anclaje (para reintentos best-effort).
--
-- El anclaje es asincrono y best-effort: un CIT puede estar 'activo' aunque su
-- anclaje siga 'pendiente' o haya quedado en 'error' (la red BFA puede tener
-- latencia o estar caida). Por eso el estado vive en su propia columna y no se
-- mezcla con `estado` (la verificacion del CIT) ni se hace bloqueante.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- Estado del anclaje on-chain del CIT en la BFA.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bfa_anclaje_estado') THEN
    CREATE TYPE bfa_anclaje_estado AS ENUM (
      'pendiente',  -- aprobado, todavia sin anclar (o reintentando)
      'anclando',   -- transaccion enviada, esperando confirmacion
      'anclado',    -- minteado y confirmado en la BFA
      'error'       -- fallo el anclaje tras agotar reintentos (revision)
    );
  END IF;
END
$$;

ALTER TABLE cits
  -- Hash de la transaccion de minteo en la BFA (0x + 64 hex).
  ADD COLUMN IF NOT EXISTS bfa_tx_hash VARCHAR(66),
  -- tokenId minteado (uint256). NUMERIC(78,0) cubre el rango completo de uint256.
  ADD COLUMN IF NOT EXISTS bfa_token_id NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS bfa_estado bfa_anclaje_estado NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS bfa_anclado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bfa_intentos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bfa_ultimo_error TEXT;

-- Barrido de reintentos: CITs activos pendientes de anclar (best-effort).
CREATE INDEX IF NOT EXISTS idx_cits_bfa_estado
  ON cits (bfa_estado)
  WHERE bfa_estado IN ('pendiente', 'anclando');
