-- RODAID — marketplace_publicaciones.slug: UNIQUE global -> indice unico
-- parcial, mismo WHERE que idx_mp_publicaciones_unica_activa_por_cit
-- (ACTIVA/PAUSADA).
--
-- Bug real encontrado 2026-07-21: retirarPublicacion() (PR #139) pone
-- estado = 'CANCELADA' pero nunca borra la fila. El slug se genera de forma
-- deterministica a partir de marca/modelo/anio/bicicleta_id
-- (slugify(...) + bici.id.slice(0,6), ver app/api/v1/marketplace/publicar/
-- route.ts) -- asi que un reintento de publicar la MISMA bicicleta (via el
-- formulario normal o via Swipe to Sell, ambos pegan al mismo
-- POST /api/v1/marketplace/publicar) genera el slug identico al de la fila
-- ya cancelada y choca contra el UNIQUE global -> Postgres 23505
-- unique_violation -> jsonError() lo devuelve como 500 INTERNAL_ERROR
-- generico ("No se pudo procesar la solicitud."), sin ninguna pista del
-- motivo real para quien lo reporta.
--
-- El slug NO se usa para routing (/marketplace/[id] siempre usa el UUID,
-- nunca el slug -- confirmado en components/rodaid/mis-publicaciones.tsx,
-- comentario del fix del 2026-07-18 sobre ese mismo punto), asi que no hay
-- riesgo de ambiguedad de URL al permitir que publicaciones
-- CANCELADA/RECHAZADA/VENDIDA compartan slug entre si o con una publicacion
-- viva mas nueva.
--
-- El UNIQUE original (`slug VARCHAR(220) NOT NULL UNIQUE`, inline en
-- 20260606180000) no tiene un nombre de constraint fijado explicitamente en
-- esa migracion -- se localiza dinamicamente via pg_constraint antes de
-- borrarlo, mismo criterio que 20260718000005 (CHECK de punto_id) para no
-- arriesgar un DROP CONSTRAINT contra un nombre adivinado.
--
-- Deliberadamente FUERA de esta migracion (mismo alcance pedido por
-- Federico: igualar el WHERE de idx_mp_publicaciones_unica_activa_por_cit,
-- no ampliarlo): ese indice de cit_id tambien fue creado en la migracion
-- original, antes de que existieran los estados de CIT Completo
-- (PUBLICADO_PENDIENTE_CERTIFICACION/PUBLICADO_CERTIFICADO/RESERVADO/
-- EJECUTANDO_LOGISTICA, agregados en 20260708000003) -- mismo patron ya
-- documentado varias veces en CLAUDE.md esta semana (codigo construido para
-- el flujo viejo, nunca actualizado). No se toca aca; queda anotado en
-- CLAUDE.md para una pasada aparte.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente (el DO
-- block solo actua si todavia encuentra el UNIQUE global; el CREATE UNIQUE
-- INDEX de abajo ya usa IF NOT EXISTS).

DO $$
DECLARE
  nombre_constraint TEXT;
BEGIN
  SELECT con.conname INTO nombre_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'marketplace_publicaciones'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) LIKE '%(slug)%';

  IF nombre_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE marketplace_publicaciones DROP CONSTRAINT %I', nombre_constraint);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_publicaciones_slug_unico_activa
  ON marketplace_publicaciones (slug)
  WHERE estado IN ('ACTIVA', 'PAUSADA');
