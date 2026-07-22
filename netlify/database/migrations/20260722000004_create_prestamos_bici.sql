-- RODAID — Prestamo gratuito de bicis certificadas propias del Taller Aliado.
--
-- NO es un alquiler pago -- no hay cobro ni medio de pago involucrado. Solo
-- bicis que el propio taller certifico como stock propio (CIT activo,
-- bicicletas.propietario_id = usuario del taller), marcadas por el taller
-- como "Disponible para prestamo" -- separado del inventario que certifica
-- para terceros. El taller asigna el prestamo a quien decida, caso por caso,
-- sin exigir cuenta RODAID verificada del prestatario ni ninguna otra
-- validacion (por eso prestatario_nombre/prestatario_contacto son texto
-- libre, no una FK a usuarios).
--
-- Sin historial de prestamos pasados a proposito (confirmado con Federico):
-- una sola fila por bici, que se resetea en cada ciclo disponible<->prestada.
-- Si mas adelante se necesita historial, es una tabla nueva aparte, no un
-- cambio retroactivo a esta.
--
-- Mientras la bici esta prestada sigue reportando por su iot_dispositivos de
-- siempre (atado a bicicleta_id, no a quien la tiene en un momento dado) --
-- nada que tocar ahi. La alerta de horario vencido reusa iot_alertas
-- (tipo='prestamo_vencido', columna de texto libre, no un enum -- no aplica
-- la regla de dos deploys), disparada por un worker periodico (ver
-- netlify/functions/prestamo-vencimiento-worker.mts), no por un chequeo al
-- cargar el panel -- decision explicita de Federico para poder sumar
-- push/email mas adelante sin rehacer esto. La alerta es SOLO interna al
-- taller (visible en su panel): no dispara Modo Robo ni notifica a RODAID o
-- autoridades.

CREATE TABLE IF NOT EXISTS prestamos_bici (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  taller_id UUID NOT NULL REFERENCES aliados (id),

  -- 'disponible' -- marcada para prestamo, sin nadie ahora mismo.
  -- 'prestada'   -- entregada, en curso.
  estado VARCHAR(16) NOT NULL DEFAULT 'disponible',

  prestatario_nombre VARCHAR(160),
  prestatario_contacto VARCHAR(160),

  hora_inicio TIMESTAMPTZ,
  hora_esperada_devolucion TIMESTAMPTZ,
  hora_devolucion_real TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT prestamos_bici_estado_chk CHECK (estado IN ('disponible', 'prestada')),
  -- Una fila por bici: no hay historial, cada ciclo pisa la misma fila.
  CONSTRAINT prestamos_bici_bicicleta_unica UNIQUE (bicicleta_id)
);

CREATE INDEX IF NOT EXISTS idx_prestamos_bici_taller
  ON prestamos_bici (taller_id, estado);

-- Sostiene el barrido del worker: solo filas 'prestada' con vencimiento.
CREATE INDEX IF NOT EXISTS idx_prestamos_bici_vencimiento
  ON prestamos_bici (hora_esperada_devolucion)
  WHERE estado = 'prestada';

DROP TRIGGER IF EXISTS trg_prestamos_bici_updated_at ON prestamos_bici;
CREATE TRIGGER trg_prestamos_bici_updated_at
  BEFORE UPDATE ON prestamos_bici
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();
