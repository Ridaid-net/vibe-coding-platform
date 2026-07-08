-- RODAID — Fase 3 (cont.): backfill de marketplace_publicaciones.estado y
-- reindexado de unicidad, ahora que los valores de enum de la migracion
-- anterior (20260708000003) ya commitearon y se pueden referenciar.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente (el UPDATE
-- solo mueve filas que todavia estan en 'ACTIVA'; correrlo de nuevo es un
-- no-op).

-- ---------------------------------------------------------------------------
-- 1) Reindexar la unicidad "a lo sumo una publicacion viva por CIT" para que
--    cubra los nuevos estados vivos, no solo ACTIVA/PAUSADA. Sin esto, una
--    bici podria terminar con dos publicaciones simultaneas (una vieja en
--    ACTIVA y otra nueva en PUBLICADO_*).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_mp_publicaciones_unica_activa_por_cit;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_publicaciones_unica_activa_por_cit
  ON marketplace_publicaciones (cit_id)
  WHERE estado IN (
    'ACTIVA', -- historico, ver migracion 20260708000003
    'PAUSADA',
    'PUBLICADO_PENDIENTE_CERTIFICACION',
    'PUBLICADO_CERTIFICADO',
    'RESERVADO',
    'EJECUTANDO_LOGISTICA'
  );

-- ---------------------------------------------------------------------------
-- 2) Backfill: toda fila todavia en 'ACTIVA' pasa al equivalente del modelo
--    nuevo. Si su CIT ya tiene un acta de inspeccion APROBADA (certificacion
--    de 20 puntos ya sellada), pasa a PUBLICADO_CERTIFICADO con el puntero al
--    acta; si no, pasa a PUBLICADO_PENDIENTE_CERTIFICACION (equivalente a como
--    se comportaba ACTIVA hasta ahora: listada, con un CIT basico, sin
--    verificacion de 20 puntos).
-- ---------------------------------------------------------------------------
UPDATE marketplace_publicaciones mp
SET estado = 'PUBLICADO_CERTIFICADO',
    inspeccion_sellado_id = sub.acta_id
FROM (
  SELECT DISTINCT ON (cit_id) cit_id, id AS acta_id
  FROM inspecciones_fisicas
  WHERE resultado = 'APROBADA'
  ORDER BY cit_id, created_at DESC
) sub
WHERE mp.estado = 'ACTIVA' AND mp.cit_id = sub.cit_id;

UPDATE marketplace_publicaciones
SET estado = 'PUBLICADO_PENDIENTE_CERTIFICACION'
WHERE estado = 'ACTIVA';
