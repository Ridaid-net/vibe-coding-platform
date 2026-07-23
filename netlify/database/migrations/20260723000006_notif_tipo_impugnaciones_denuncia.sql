-- RODAID — Esquema 4: impugnación de denuncia falsa (vendedor deshonesto
-- denuncia DESPUÉS de vender por afuera).
--
-- Solo agrega valores de enum, sin usarlos todavia (misma regla documentada
-- en CLAUDE.md: un ALTER TYPE ADD VALUE y su primer uso no pueden compartir
-- deploy). El resto del sistema de impugnaciones va en una migracion/PR
-- separado, despues de que este deploy quede confirmado 'ready' en
-- produccion.

ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'IMPUGNACION_DENUNCIA_RESUELTA';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'IMPUGNACION_DENUNCIA_CONFIRMADA_CONTRA_DENUNCIANTE';
