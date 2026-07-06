-- Data cleanup: remove a pending workshop ("taller") registration.
--
-- The original request was expressed as:
--   DELETE FROM talleres WHERE email = 'federicodegeaceo@rodaid.net'
--     AND estado = 'pendiente';
--
-- The `talleres` table is the CIT geofencing reference (id/lat/lng/radio) and
-- has no `email` or `estado` columns, so that statement cannot run there. The
-- partner workshops ("talleres aliados") that carry `email` and `estado` live
-- in the `aliados` table. This migration applies the intended deletion against
-- `aliados`, matching the exact criteria from the request. It removes the
-- single matching pending row (nombre "Taller Prueba RODAID"). If the row is
-- already gone, the statement affects zero rows and is a no-op.

DELETE FROM aliados
WHERE email = 'federicodegeaceo@rodaid.net'
  AND estado = 'pendiente';
