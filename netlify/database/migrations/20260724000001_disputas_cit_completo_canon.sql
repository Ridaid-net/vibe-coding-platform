-- RODAID — Mecanismo de canon para disputas CIT Completo (Esquema 1 Caso B).
-- Diseño confirmado con Federico 2026-07-12 (CLAUDE.md, "Mecanismo de canon
-- para iniciar disputas") y las 3 preguntas pendientes resueltas 2026-07-24:
--
--   1) Resultado separado en la revision humana: la sancion al vendedor
--      (confirmar_naranja/desestimar) y el juicio de buena fe del COMPRADOR
--      son dos decisiones distintas -- comprador_buena_fe es un campo
--      aparte, no derivado de la decision sobre el vendedor.
--   2) La devolucion del canon es SIEMPRE manual (accion aparte del admin,
--      nunca disparada automaticamente por ninguna resolucion).
--   3) De que pago se descuenta cuando hay sena Y saldo retenidos
--      simultaneamente: Opcion 2 confirmada -- se descuenta primero del
--      saldo (representa el valor real de venta del rodado; la sena es un
--      fee fijo de CIT Completo, sin relacion con el precio de la bici), y
--      solo si no alcanza se completa con la sena. El canon nunca excede el
--      20% teorico, pero tampoco se persigue via deuda si lo retenido no
--      alcanza -- queda capado a lo que efectivamente hubiera en custodia.
--
-- `canon_detalle` (JSONB, array de {paymentId, montoArs}) guarda de que
-- pago(s) de MercadoPago salio el canon retenido -- es lo que necesita
-- devolverCanon() para poder emitir el/los reembolso(s) parciales
-- correspondientes mas adelante, sin tener que re-derivarlo.
--
-- VARCHAR/JSONB, sin ENUM nuevo -- no aplica la regla de dos deploys.
--
-- Roll-forward: aditivo, no toca ninguna fila existente mas alla de los
-- defaults (la tabla puede tener disputas reales ya resueltas desde el
-- 2026-07-23 sin canon -- quedan con canon_teorico_ars/retenido_ars = 0,
-- correcto: esas disputas se abrieron antes de que el canon existiera).
-- Idempotente.

ALTER TABLE disputas_cit_completo
  ADD COLUMN IF NOT EXISTS canon_teorico_ars NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canon_retenido_ars NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canon_detalle JSONB,
  ADD COLUMN IF NOT EXISTS comprador_buena_fe BOOLEAN,
  ADD COLUMN IF NOT EXISTS canon_devuelto BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS canon_devuelto_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canon_devuelto_por UUID REFERENCES usuarios (id);

-- Cola de "canon retenido, pendiente de devolver" -- consultada por el panel
-- admin para saber a quien todavia se le debe el canon.
CREATE INDEX IF NOT EXISTS idx_disputas_cit_canon_pendiente
  ON disputas_cit_completo (resuelta_en)
  WHERE canon_retenido_ars > 0 AND canon_devuelto = FALSE;
