-- RODAID — Datos bancarios para el payout real (CBU/alias) a vendedores y
-- Talleres Aliados.
--
-- Prerrequisito para conectar ejecutarTransferencia() (compensaciones.service.ts,
-- hoy un stub que nunca mueve dinero real) a una transferencia bancaria real:
-- hasta ahora no existia ningun lugar donde guardar el destino del pago. Tabla
-- generica (beneficiario_tipo/beneficiario_id) porque tanto un vendedor
-- (usuario) como un Taller Aliado cobran por este mismo mecanismo (Fee de
-- Verificacion/Logistica/Exito, ver pagos_liquidaciones).
--
-- Una sola fila por beneficiario (indice unico): es el dato VIGENTE, no un
-- historial -- la trazabilidad de que CBU/alias se uso en cada pago ya
-- concretado vive en las columnas nuevas de pagos_liquidaciones (mas abajo),
-- copiadas una sola vez al crear cada liquidacion.
CREATE TABLE IF NOT EXISTS datos_bancarios_payout (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiario_tipo VARCHAR(20) NOT NULL,
  beneficiario_id UUID NOT NULL,
  cbu VARCHAR(22),
  alias VARCHAR(20),
  titular_declarado VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT datos_bancarios_payout_beneficiario_tipo_chk
    CHECK (beneficiario_tipo IN ('usuario', 'aliado')),
  CONSTRAINT datos_bancarios_payout_cbu_o_alias_chk
    CHECK (cbu IS NOT NULL OR alias IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_datos_bancarios_payout_beneficiario
  ON datos_bancarios_payout (beneficiario_tipo, beneficiario_id);

DROP TRIGGER IF EXISTS trg_datos_bancarios_payout_updated_at ON datos_bancarios_payout;
CREATE TRIGGER trg_datos_bancarios_payout_updated_at
  BEFORE UPDATE ON datos_bancarios_payout
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

-- Copia congelada del destino usado en cada liquidacion -- si el beneficiario
-- cambia su CBU despues, una liquidacion ya emitida conserva el dato con el
-- que se emitio (trazabilidad historica real, no una referencia mutable al
-- perfil actual). Nullable a proposito: una liquidacion puede registrarse (la
-- deuda es real, ver pagos_liquidaciones) antes de que el beneficiario haya
-- cargado sus datos bancarios.
ALTER TABLE pagos_liquidaciones
  ADD COLUMN IF NOT EXISTS cbu_destino VARCHAR(22),
  ADD COLUMN IF NOT EXISTS alias_destino VARCHAR(20),
  ADD COLUMN IF NOT EXISTS titular_destino VARCHAR(160);
