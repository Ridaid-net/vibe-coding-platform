-- RODAID — Esquema 3: reclamo de titularidad (venta fuera de la plataforma).
--
-- Solo agrega valores de enum, sin usarlos todavia (misma regla documentada
-- en CLAUDE.md: un ALTER TYPE ADD VALUE y su primer uso no pueden compartir
-- deploy). El resto del sistema de reclamos va en una migracion/PR separado,
-- despues de que este deploy quede confirmado 'ready' en produccion.

ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'RECLAMO_TITULARIDAD_ABIERTO';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'RECLAMO_TITULARIDAD_RECHAZADO';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'RECLAMO_TITULARIDAD_APROBADO';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'RECLAMO_TITULARIDAD_DESESTIMADO';
