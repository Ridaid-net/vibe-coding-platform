-- RODAID — Checklist Premium: marca explícita de si el módulo premium
-- estuvo activo en esta inspección, mismo criterio y mismo tipo que
-- modulo_componentes (20260718000002): la ausencia de filas en
-- componentes_tokenizados para los punto_id PR01-PR08 no distingue "el
-- inspector activó el módulo premium y no encontró nada que cargar" de
-- "nunca se ofreció el módulo premium" -- inaceptable para algo auditable.
--
-- El detalle punto-por-punto del checklist premium (resultado/nota por cada
-- PR01-PR08) se guarda en la MISMA columna checklist_detalle (JSONB) que ya
-- usa el checklist base -- es un objeto plano keyeado por punto_id, ya
-- acepta cualquier clave sin schema propio, no hace falta columna nueva
-- para esto.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

ALTER TABLE inspecciones_fisicas
  ADD COLUMN IF NOT EXISTS modulo_premium BOOLEAN NOT NULL DEFAULT FALSE;
