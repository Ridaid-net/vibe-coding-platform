-- RODAID — Esquema 1 Caso B: disputa comprador/vendedor de CIT Completo.
--
-- Solo agrega valores de enum, sin usarlos todavia (misma regla documentada
-- en CLAUDE.md: un ALTER TYPE ADD VALUE y su primer uso no pueden compartir
-- deploy). El resto del sistema de disputas va en una migracion/PR separado,
-- despues de que este deploy quede confirmado 'ready' en produccion.

ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'DISPUTA_CIT_ABIERTA';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'DISPUTA_CIT_AMARILLA';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'DISPUTA_CIT_EN_REVISION';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'DISPUTA_CIT_RESUELTA';
