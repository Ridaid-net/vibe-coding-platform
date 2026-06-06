-- RODAID — Modulo 7, Fase C: entrega del NFT (ERC-721 sobre la BFA) y
-- contabilidad de comisiones del Plan Libre.
--
-- Roll-forward (timestamp 200000, posterior a usuarios/marketplace/escrow).
-- NO se edita ninguna migracion ya aplicada: este archivo agrega columnas y
-- tablas nuevas de forma idempotente.
--
-- Contenido:
--   * usuarios.direccion_evm   -> wallet EVM del comprador (entrega non-custodial)
--   * cits.propietario_id      -> titular interno del CIT (entrega custodial)
--   * nft_transferencias       -> cola/auditoria de la mensajeria on-chain a la BFA
--   * rodaid_comisiones        -> libro contable de la retencion del 2.5%

-- ── usuarios: direccion EVM vinculada (opcional) ────────────────────────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS direccion_evm VARCHAR(42);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_direccion_evm_formato'
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_direccion_evm_formato
      CHECK (direccion_evm IS NULL OR direccion_evm ~ '^0x[0-9a-fA-F]{40}$');
  END IF;
END
$$;

-- ── cits: titular interno (para la custodia hasta que se reclame el NFT) ─────
ALTER TABLE cits
  ADD COLUMN IF NOT EXISTS propietario_id UUID REFERENCES usuarios (id);

CREATE INDEX IF NOT EXISTS idx_cits_propietario ON cits (propietario_id);

-- ── nft_transferencias: cola de mensajeria on-chain + auditoria BFA ─────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nft_transferencia_estado') THEN
    CREATE TYPE nft_transferencia_estado AS ENUM (
      'PENDIENTE',   -- encolada tras la venta, aun no procesada
      'EN_PROCESO',  -- transferencia on-chain en curso contra la BFA
      'CONFIRMADA',  -- el NFT quedo en la wallet del comprador
      'CUSTODIADO',  -- sin wallet: el NFT sigue en la wallet central de RODAID
      'SIN_WALLET',  -- detectado sin wallet (transitorio antes de la custodia)
      'FALLIDA'      -- fracaso definitivo tras agotar los reintentos
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS nft_transferencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID NOT NULL REFERENCES escrow_transacciones (id),
  publicacion_id UUID NOT NULL REFERENCES marketplace_publicaciones (id),
  cit_id UUID NOT NULL REFERENCES cits (id),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  comprador_id UUID NOT NULL REFERENCES usuarios (id),
  destino_evm VARCHAR(42),
  estado nft_transferencia_estado NOT NULL DEFAULT 'PENDIENTE',
  tx_hash VARCHAR(80),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  max_intentos INTEGER NOT NULL DEFAULT 5 CHECK (max_intentos > 0),
  proximo_reintento_en TIMESTAMPTZ,
  ultimo_error TEXT,
  error_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  reclamado_en TIMESTAMPTZ,
  confirmada_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola transferencia de NFT por transaccion de escrow.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nft_transferencias_transaccion
  ON nft_transferencias (transaccion_id);

-- Barrido de reintentos: filas reintentables cuyo proximo intento ya vencio.
CREATE INDEX IF NOT EXISTS idx_nft_transferencias_reintento
  ON nft_transferencias (proximo_reintento_en)
  WHERE estado IN ('PENDIENTE', 'EN_PROCESO');

CREATE INDEX IF NOT EXISTS idx_nft_transferencias_comprador
  ON nft_transferencias (comprador_id);

CREATE INDEX IF NOT EXISTS idx_nft_transferencias_cit
  ON nft_transferencias (cit_id);

-- ── rodaid_comisiones: libro contable del Plan Libre (retencion del 2.5%) ───
CREATE TABLE IF NOT EXISTS rodaid_comisiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID NOT NULL REFERENCES escrow_transacciones (id),
  publicacion_id UUID NOT NULL REFERENCES marketplace_publicaciones (id),
  vendedor_id UUID NOT NULL REFERENCES usuarios (id),
  comprador_id UUID NOT NULL REFERENCES usuarios (id),
  plan VARCHAR(20) NOT NULL DEFAULT 'LIBRE',
  gateway VARCHAR(20) NOT NULL DEFAULT 'stub',
  precio_final_ars NUMERIC(12,2) NOT NULL CHECK (precio_final_ars > 0),
  tasa_comision NUMERIC(6,4) NOT NULL CHECK (tasa_comision >= 0),
  retencion_bruta_ars NUMERIC(12,2) NOT NULL CHECK (retencion_bruta_ars >= 0),
  tasa_pasarela NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (tasa_pasarela >= 0),
  costo_pasarela_ars NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (costo_pasarela_ars >= 0),
  ganancia_neta_ars NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotencia contable: una sola partida por transaccion.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rodaid_comisiones_transaccion
  ON rodaid_comisiones (transaccion_id);

CREATE INDEX IF NOT EXISTS idx_rodaid_comisiones_created
  ON rodaid_comisiones (created_at DESC);
