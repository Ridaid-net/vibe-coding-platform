-- RODAID — Segundo punto de entrada a CIT Completo/Transferencia: "acuerdo
-- privado". Comprador y vendedor ya se pusieron de acuerdo por fuera del
-- Marketplace (redes sociales, boca a boca) y solo necesitan que un Taller
-- Aliado corra la verificacion de 20 puntos antes de transferir -- mismo
-- precio ($28.500), misma inspeccion, mismo flujo de reserva/pago
-- (iniciarReservaCitCompleto/confirmarPagoCitCompleto) que el camino
-- publico, sin ningun cambio. Diseno confirmado con Federico 2026-07-23.
--
-- `origen` distingue una publicacion nacida del flujo publico normal
-- (POST /api/v1/marketplace/publicar, visible en el grid) de una nacida de
-- este segundo camino (POST /api/v1/marketplace/acuerdo-privado,
-- deliberadamente invisible en el grid publico y sus facetas -- ver el
-- filtro nuevo en app/api/v1/marketplace/route.ts). Es puramente
-- informativo/de visibilidad: no crea ningun estado ni camino de dinero
-- nuevo, y ninguna proteccion de doble venta existente (indices por
-- cit_id/publicacion_id, todos enumerados por estado, nunca por origen)
-- necesita tocarse.
--
-- VARCHAR + CHECK, no ENUM nativo -- mismo criterio ya usado esta semana
-- para las columnas estado/tipo de las piezas de disputas, evita la regla
-- de dos deploys si se suma un tercer origen mas adelante.
--
-- Roll-forward: no toca ninguna fila existente mas alla de fijar el
-- DEFAULT (toda publicacion ya creada es, correctamente, 'marketplace').
-- Idempotente.

ALTER TABLE marketplace_publicaciones
  ADD COLUMN IF NOT EXISTS origen VARCHAR(24) NOT NULL DEFAULT 'marketplace'
    CHECK (origen IN ('marketplace', 'acuerdo_privado'));

CREATE INDEX IF NOT EXISTS idx_mp_publicaciones_origen_acuerdo_privado
  ON marketplace_publicaciones (origen)
  WHERE origen = 'acuerdo_privado';
