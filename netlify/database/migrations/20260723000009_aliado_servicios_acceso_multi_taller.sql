-- RODAID — Acceso multi-taller por bici (Garaje Digital). Confirmado con
-- Federico: el dueño de una bici debe poder dar acceso al panel de
-- servicios de su bici a un Taller Aliado nuevo, y decidir en ese momento
-- si mantiene o revoca el acceso del taller anterior -- no es una
-- transferencia exclusiva automatica, es control de permisos por bici que
-- el usuario administra (caso real: se muda de domicilio, necesita un
-- taller mas cercano para la revalidacion del CIT).
--
-- Diagnostico previo (ya en produccion): el vinculo bici<->taller ya es
-- estructuralmente many-to-many via `aliado_servicios` (UNIQUE
-- (aliado_id, bicicleta_id)) -- no hace falta tabla nueva. Lo que faltaba
-- era (1) un concepto de "cual de los talleres vinculados es el que
-- resuelve automaticamente" (usado por CIT Completo,
-- resolverAliadoPorBicicleta() en aliados.service.ts, hoy "el vinculo mas
-- reciente gana" sin que el dueño lo elija) y (2) una forma real de
-- revocar sin borrar el historial.
--
-- `es_principal`: cual de los talleres vinculados es el que
-- resolverAliadoPorBicicleta() (CIT Completo) usa automaticamente. A lo
-- sumo uno por bici, entre los NO revocados (indice unico parcial abajo).
-- Backfill: el vinculo mas reciente de cada bici pasa a ser el principal,
-- para que el comportamiento de resolverAliadoPorBicicleta() no cambie
-- para ninguna bici ya vinculada hoy.
--
-- `revocado_en`: revocar ya no borra la fila (se pierde el historial de
-- quien sirvio la bici) -- solo la marca como no vigente. Si se revoca el
-- principal sin elegir reemplazo, la bici queda SIN principal
-- (resolverAliadoPorBicicleta() devuelve null, 422 SIN_TALLER_VINCULADO,
-- mismo gate que ya existe) hasta que el dueño elija uno nuevo -- nunca se
-- promueve otro automaticamente.
--
-- Roll-forward: no toca ninguna fila mas alla del backfill de es_principal
-- (aditivo, reversible). Idempotente (columnas con IF NOT EXISTS, backfill
-- solo actua sobre filas que hoy tienen es_principal = FALSE).

ALTER TABLE aliado_servicios
  ADD COLUMN IF NOT EXISTS es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS revocado_en TIMESTAMPTZ;

-- A lo sumo un principal vigente (no revocado) por bici.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aliado_servicios_principal_unico
  ON aliado_servicios (bicicleta_id)
  WHERE es_principal = TRUE AND revocado_en IS NULL;

-- Backfill: el vinculo mas reciente de cada bici (mismo criterio que ya
-- usaba resolverAliadoPorBicicleta() antes de este cambio) pasa a
-- es_principal = TRUE, para preservar el comportamiento actual sin
-- necesitar ningun fallback en el codigo.
WITH ultimo_vinculo AS (
  SELECT DISTINCT ON (bicicleta_id) id
  FROM aliado_servicios
  ORDER BY bicicleta_id, created_at DESC
)
UPDATE aliado_servicios
SET es_principal = TRUE
WHERE id IN (SELECT id FROM ultimo_vinculo);
