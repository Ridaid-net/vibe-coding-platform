-- RODAID — Reserva simple de CIT (Garaje Digital -> Taller Aliado).
--
-- El ciclista elige un Taller Aliado desde su Garaje Digital y deja una
-- "solicitud de reserva" -- sin horario, sin pago, sin elegir tipo de CIT
-- (Express/Completo se define despues, cuando el taller lo contacta por
-- fuera del sistema). El taller ve sus solicitudes pendientes en su panel.
--
-- No existe ningun concepto de turno/lead en el esquema hasta ahora -- tabla
-- nueva y chica, sin dependencia de ningun enum existente (evita la regla de
-- dos deploys de ALTER TYPE ... ADD VALUE).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'solicitud_reserva_taller_estado') THEN
    CREATE TYPE solicitud_reserva_taller_estado AS ENUM ('pendiente', 'contactado', 'cerrada');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS solicitudes_reserva_taller (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  usuario_id   UUID NOT NULL REFERENCES usuarios (id),
  aliado_id    UUID NOT NULL REFERENCES aliados (id),
  nota         TEXT,
  estado       solicitud_reserva_taller_estado NOT NULL DEFAULT 'pendiente',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Listado del taller (mas recientes primero, filtrado por estado).
CREATE INDEX IF NOT EXISTS idx_solicitudes_reserva_taller_aliado
  ON solicitudes_reserva_taller (aliado_id, estado, created_at DESC);

-- Historial del usuario sobre una bici puntual.
CREATE INDEX IF NOT EXISTS idx_solicitudes_reserva_taller_bici
  ON solicitudes_reserva_taller (bicicleta_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_solicitudes_reserva_taller_updated_at ON solicitudes_reserva_taller;
CREATE TRIGGER trg_solicitudes_reserva_taller_updated_at
  BEFORE UPDATE ON solicitudes_reserva_taller
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();
