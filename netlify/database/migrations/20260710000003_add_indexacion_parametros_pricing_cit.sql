-- RODAID — Indexacion de precios CIT al dolar oficial BNA.
--
-- Agrega el "ancla" en USD y la cotizacion vigente al momento de fijarlo a cada
-- parametro de pricing que debe indexarse automaticamente. El ancla en USD
-- (usd_ancla) NUNCA lo toca el mecanismo automatico -- solo la ARS derivada
-- (valor) y la cotizacion de referencia (cotizacion_ancla) se actualizan
-- cuando el mecanismo ajusta. Re-anclar el valor en USD es siempre una
-- decision manual de Federico, no del worker.
--
-- indexado es opt-in explicito por fila: el mecanismo automatico solo toca
-- las filas marcadas TRUE, para no arrastrar costos de insumo (ej.
-- cit_completo_costo_variable_ars) que no son precios comerciales en dolares.
--
-- No es una ALTER TYPE de enum -- son columnas nuevas + un CHECK de tabla, no
-- un valor nuevo de un tipo enum de Postgres. No aplica la restriccion de
-- "deploys separados" documentada en CLAUDE.md para ALTER TYPE ... ADD VALUE.

ALTER TABLE parametros_pricing_cit
  ADD COLUMN IF NOT EXISTS usd_ancla NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS cotizacion_ancla NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS indexado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ultimo_ajuste_en TIMESTAMPTZ;

ALTER TABLE parametros_pricing_cit
  DROP CONSTRAINT IF EXISTS chk_pricing_cit_indexado_requiere_ancla;
ALTER TABLE parametros_pricing_cit
  ADD CONSTRAINT chk_pricing_cit_indexado_requiere_ancla
  CHECK (NOT indexado OR (usd_ancla IS NOT NULL AND cotizacion_ancla IS NOT NULL));

-- Anclas iniciales (10/07/2026, dolar BNA venta = 1510), confirmadas por
-- Federico. Los 4 parametros comerciales en ARS del CIT Completo/Express que
-- se indexan; cit_completo_costo_variable_ars (costo de insumo, no precio
-- comercial) queda deliberadamente afuera con indexado = FALSE (default).
UPDATE parametros_pricing_cit
SET usd_ancla = 3.38, cotizacion_ancla = 1510, indexado = TRUE
WHERE clave = 'cit_express_precio_ars';

UPDATE parametros_pricing_cit
SET usd_ancla = 18.87, cotizacion_ancla = 1510, indexado = TRUE
WHERE clave = 'cit_completo_precio_publicado_ars';

UPDATE parametros_pricing_cit
SET usd_ancla = 11.92, cotizacion_ancla = 1510, indexado = TRUE
WHERE clave = 'cit_completo_fee_verificacion_ars';

UPDATE parametros_pricing_cit
SET usd_ancla = 9.93, cotizacion_ancla = 1510, indexado = TRUE
WHERE clave = 'cit_completo_fee_logistica_ars';
