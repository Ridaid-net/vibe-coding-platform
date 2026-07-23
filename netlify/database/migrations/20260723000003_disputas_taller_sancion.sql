-- RODAID — Esquema 2: sanción a Talleres Aliados cómplices, parte (a).
--
-- Diseño acordado con Federico 2026-07-23: la sanción a un Taller Aliado se
-- dispara desde la MISMA revisión humana de una disputa de CIT Completo
-- (Esquema 1 Caso B) que ya existe — el admin puede marcar, además de la
-- decisión sobre el vendedor (confirmar_naranja/desestimar), que el Taller
-- también actuó de mala fe (ej. certificó una inspección que nunca hizo, o
-- coludió con el vendedor), reusando la misma evidencia ya presentada. No es
-- un canal de denuncia nuevo — eso es la parte (b), documentada en CLAUDE.md
-- y deliberadamente diferida para otra pasada, mismo tratamiento que los
-- Esquemas 3 y 4.
--
-- Mecanismo de cobro: deuda nueva (deudas_talleres), mismo patrón ya usado
-- para deudas_vendedores. Escalamiento: NUNCA automático — los antecedentes
-- confirmados en los últimos 24 meses solo se cuentan para darle contexto al
-- admin que revisa un caso nuevo del mismo taller (ver
-- contarAntecedentesTaller() en disputas-cit-completo.service.ts); ninguna
-- suspensión del taller ocurre sin una decisión humana aparte.
--
-- Roll-forward: no toca ninguna migración ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Denormalizar el Taller Aliado de la transacción sobre la disputa, y el
--    resultado de la sanción — mismo criterio que vendedor_id/comprador_id
--    ya denormalizados en esta tabla, para no tener que joinear con
--    escrow_transacciones en cada lectura.
-- ---------------------------------------------------------------------------
ALTER TABLE disputas_cit_completo
  ADD COLUMN IF NOT EXISTS aliado_id UUID REFERENCES aliados (id),
  ADD COLUMN IF NOT EXISTS taller_sancionado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS taller_sancion_nota TEXT;

-- Backfill defensivo — en producción esta tabla está vacía al momento de esta
-- migración (nadie abrió una disputa real todavía), pero no cuesta nada
-- dejarlo por si acaso.
UPDATE disputas_cit_completo dcc
SET aliado_id = et.aliado_id
FROM escrow_transacciones et
WHERE et.id = dcc.escrow_transaccion_id
  AND dcc.aliado_id IS NULL
  AND et.aliado_id IS NOT NULL;

-- Antecedentes confirmados de un taller en una ventana de tiempo (24 meses,
-- calculado en la app, no acá) — usado solo para darle contexto al admin.
CREATE INDEX IF NOT EXISTS idx_disputas_cit_taller_sancionado
  ON disputas_cit_completo (aliado_id, resuelta_en)
  WHERE taller_sancionado = TRUE;

-- ---------------------------------------------------------------------------
-- 2) Deuda del Taller Aliado — mismo patrón que deudas_vendedores.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deudas_talleres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aliado_id UUID NOT NULL REFERENCES aliados (id),
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  motivo TEXT NOT NULL,
  disputa_id UUID REFERENCES disputas_cit_completo (id),
  estado VARCHAR(12) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'pagada', 'condonada')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pagada_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deudas_talleres_aliado_pendiente
  ON deudas_talleres (aliado_id)
  WHERE estado = 'pendiente';
