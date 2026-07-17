-- RODAID — Checklist de 20 puntos: detalle punto-por-punto de la inspeccion
-- + marca explicita de "CIT Completo Plus" (modulo de tokenizacion de
-- componentes).
--
-- Hasta ahora inspecciones_fisicas solo guardaba el veredicto agregado
-- (resultado APROBADA/DISCREPANCIA) mas notas libres -- el detalle de los 20
-- puntos individuales (lib/puntos-inspeccion.ts::PUNTOS_INSPECCION) se
-- calculaba en el cliente (ChecklistCIT.tsx) pero nunca llegaba a
-- persistirse (componente huerfano, nunca montado; ver auditoria CLAUDE.md
-- 2026-07-17).
--
-- checklist_detalle es JSONB, no una tabla nueva: se lee siempre completo
-- junto con su fila padre (nunca se necesita "todas las inspecciones donde
-- el punto P13 dio falla" como query independiente), mismo criterio ya
-- aplicado a denuncias_mpf.validacion. Los 5 puntos que SI necesitan
-- identidad propia y unicidad entre filas (marca/modelo/numero_serie de un
-- componente reemplazable) van en una tabla dedicada aparte:
-- componentes_tokenizados (ver 20260718000003).
--
-- Forma esperada de checklist_detalle (objeto plano, keyeado por punto_id
-- P01..P20):
--   { "P01": {"resultado":"ok"}, "P07": {"resultado":"observacion","nota":"..."}, ... }
--
-- modulo_componentes: NO se deriva de si existen filas en
-- componentes_tokenizados para esta inspeccion -- un inspector puede activar
-- el modulo Plus y no encontrar un serial legible en ninguno de los 5 puntos
-- candidatos ese dia (0 filas resultantes, igual de valido). Sin esta
-- columna, "0 componentes capturados" y "nunca se ofrecio el modulo Plus"
-- serian indistinguibles -- inaceptable para algo que se declara al
-- Ministerio. Mismo lugar y mismo tipo que acelero_pipeline, que ya resuelve
-- exactamente este problema para otro flag opcional de la misma fila.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

ALTER TABLE inspecciones_fisicas
  ADD COLUMN IF NOT EXISTS checklist_detalle JSONB,
  ADD COLUMN IF NOT EXISTS modulo_componentes BOOLEAN NOT NULL DEFAULT FALSE;
