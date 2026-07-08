-- RODAID — Fase 3: Maquina de estados de CIT Completo (Marketplace + Escrow).
--
-- Extiende, en vez de reemplazar, la maquina de estados de publicaciones y el
-- escrow de compraventa (Fase A/B) para soportar el flujo de CIT Completo:
-- verificacion de 20 puntos financiada por la sena del comprador, logistica de
-- ejecucion y fee de exito, con el Taller Aliado cobrando por cada concepto.
--
-- 'ACTIVA' (marketplace_publicacion_estado) queda como valor HISTORICO: no se
-- puede borrar de un enum de Postgres sin recrear el tipo, y solo hay una fila
-- de prueba hoy, asi que se backfillea (ver migracion siguiente) y el codigo
-- deja de escribirla, pero el valor persiste en el tipo.
--
-- IMPORTANTE: los valores de enum agregados aqui (ALTER TYPE ... ADD VALUE) NO
-- se pueden referenciar todavia en esta misma migracion/transaccion (Postgres
-- no permite usar un valor de enum recien creado antes de que el ADD VALUE
-- haya commiteado) — por eso el backfill y el reindexado que los usan van en
-- la migracion 20260708000004, no aca.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Nuevos estados de publicacion.
-- ---------------------------------------------------------------------------
ALTER TYPE marketplace_publicacion_estado ADD VALUE IF NOT EXISTS 'PUBLICADO_PENDIENTE_CERTIFICACION';
ALTER TYPE marketplace_publicacion_estado ADD VALUE IF NOT EXISTS 'PUBLICADO_CERTIFICADO';
ALTER TYPE marketplace_publicacion_estado ADD VALUE IF NOT EXISTS 'RESERVADO';
ALTER TYPE marketplace_publicacion_estado ADD VALUE IF NOT EXISTS 'EJECUTANDO_LOGISTICA';

-- ---------------------------------------------------------------------------
-- 2) Nuevos tipos de liquidacion: pago al Taller Aliado por cada concepto de
--    CIT Completo. Reusa el motor de pagos_liquidaciones (Hito 13) en vez de
--    crear una tabla de payouts en paralelo.
-- ---------------------------------------------------------------------------
ALTER TYPE liquidacion_tipo ADD VALUE IF NOT EXISTS 'ALIADO_FEE_VERIFICACION';
ALTER TYPE liquidacion_tipo ADD VALUE IF NOT EXISTS 'ALIADO_FEE_LOGISTICA';
ALTER TYPE liquidacion_tipo ADD VALUE IF NOT EXISTS 'ALIADO_FEE_EXITO';

-- ---------------------------------------------------------------------------
-- 3) escrow_transacciones — snapshot congelado de los fees de CIT Completo al
--    momento de cobrarse (no se recalculan si parametros_pricing_cit cambia
--    despues). Separa cobrado-al-comprador de pagado-al-taller en logistica
--    (la diferencia es la comision de pasarela, no margen de RODAID) y separa
--    el fee de exito en rodaid/taller (su split).
-- ---------------------------------------------------------------------------
ALTER TABLE escrow_transacciones
  ADD COLUMN IF NOT EXISTS aliado_id UUID REFERENCES aliados (id),
  ADD COLUMN IF NOT EXISTS disparo_verificacion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fee_verificacion_ars NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (fee_verificacion_ars >= 0),
  ADD COLUMN IF NOT EXISTS fee_logistica_cobrado_comprador_ars NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (fee_logistica_cobrado_comprador_ars >= 0),
  ADD COLUMN IF NOT EXISTS fee_logistica_pagado_taller_ars NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (fee_logistica_pagado_taller_ars >= 0),
  ADD COLUMN IF NOT EXISTS fee_exito_total_ars NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (fee_exito_total_ars >= 0),
  ADD COLUMN IF NOT EXISTS fee_exito_rodaid_ars NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (fee_exito_rodaid_ars >= 0),
  ADD COLUMN IF NOT EXISTS fee_exito_taller_ars NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (fee_exito_taller_ars >= 0);

CREATE INDEX IF NOT EXISTS idx_escrow_tx_aliado
  ON escrow_transacciones (aliado_id)
  WHERE aliado_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) marketplace_publicaciones — puntero directo al acta de inspeccion que
--    sello la certificacion (evita JOIN + ORDER BY + LIMIT 1 para saber si una
--    publicacion ya esta certificada).
-- ---------------------------------------------------------------------------
ALTER TABLE marketplace_publicaciones
  ADD COLUMN IF NOT EXISTS inspeccion_sellado_id UUID REFERENCES inspecciones_fisicas (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mp_publicaciones_inspeccion_sellado
  ON marketplace_publicaciones (inspeccion_sellado_id)
  WHERE inspeccion_sellado_id IS NOT NULL;
