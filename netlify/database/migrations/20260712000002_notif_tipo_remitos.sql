-- RODAID — Nuevos tipos de notificacion para el flujo del Remito de CIT
-- Completo (ver 20260712000001_create_remitos.sql).
--
-- REGLA DE DOS DEPLOYS (ya documentada en CLAUDE.md): un valor agregado con
-- ALTER TYPE ... ADD VALUE no se puede usar todavia dentro del mismo deploy
-- que lo agrega (Postgres tira 55P04, "unsafe use of new value"). Esta
-- migracion SOLO agrega los valores del enum -- ningun otro archivo de este
-- mismo deploy/PR debe leer, escribir ni filtrar por REMITO_GENERADO,
-- REMITO_RECORDATORIO o REMITO_DESPACHADO. El codigo que los usa
-- (notif.service.ts, los endpoints de generar/despachar remito, el worker de
-- recordatorios) va en un PR/deploy POSTERIOR, una vez que este quede `ready`
-- en produccion.
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'REMITO_GENERADO';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'REMITO_RECORDATORIO';
ALTER TYPE notif_tipo ADD VALUE IF NOT EXISTS 'REMITO_DESPACHADO';
