-- RODAID — Auditoría de modelo de datos (2026-07-16): eliminar columna huérfana.
--
-- `bicicletas.numero_cuadro` (VARCHAR(120), nullable) fue introducida por error
-- en la recreación de tablas del 2026-06-18 (20260618121000_create_cit_tablas.sql,
-- la misma migración `DROP TABLE ... CASCADE` ya documentada en CLAUDE.md como
-- origen de otros bugs de esa fecha). No existía en el diseño original
-- (20260616120000_create_bicicletas_cits.sql), que ya definía `numero_serie`
-- con el comentario "Numero de serie del cuadro: identificador fisico" — es
-- decir, `numero_serie` siempre fue, conceptualmente, el mismo dato que
-- "número de cuadro". `numero_cuadro` es un duplicado accidental de ese mismo
-- concepto, no un segundo identificador pensado a propósito.
--
-- Confirmado antes de eliminar (no se toca la base de produccion desde el
-- codigo, ni en modo lectura, sin que Federico lo corra el mismo):
--   - Grep exhaustivo de `numero_cuadro` en todo el codigo (.ts/.tsx): CERO
--     llamadores reales, columna nunca leida ni escrita por ninguna ruta o
--     servicio.
--   - Federico confirmo en la consola de Neon:
--     SELECT COUNT(*) FROM bicicletas WHERE numero_cuadro IS NOT NULL;  -- 0
--     Cero filas con dato cargado en esa columna en produccion.
--
-- Roll-forward: no toca ninguna migracion ya aplicada.

ALTER TABLE bicicletas
  DROP COLUMN IF EXISTS numero_cuadro;
