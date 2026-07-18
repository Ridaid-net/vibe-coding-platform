-- RODAID — elimina el tenant_id huerfano de oauth_connections/bike_activities
-- (Hito 17 BYOD). Quedo apuntando a nada real cuando `tenants` fue recreada
-- con PK UUID en 20260706000003_multi_tenant_rls.sql (el DROP TABLE CASCADE
-- se llevo puesto el FK original hacia el tenants viejo, VARCHAR(50)).
--
-- Confirmado por barrido completo del schema (mismo criterio que el barrido
-- de fecha_vencimiento): son las UNICAS 2 columnas de todas las migraciones
-- con el patron `tenant_id VARCHAR(50) REFERENCES tenants(id)`. Ninguna de
-- las dos tablas tiene RLS activo (confirmado via pg_class.relrowsecurity
-- contra produccion), y ningun codigo vivo filtra por esta columna en un
-- WHERE -- solo se insertaba (con el string literal 'rodaid', ya sin
-- sentido bajo el esquema UUID) y se re-copiaba de una tabla a la otra. Se
-- elimina en vez de reasignar al tenant real: no tiene ningun consumidor
-- funcional hoy.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

ALTER TABLE oauth_connections DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE bike_activities DROP COLUMN IF EXISTS tenant_id;
DROP INDEX IF EXISTS bike_activities_tenant_idx;
