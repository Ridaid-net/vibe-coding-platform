-- RODAID — Modulo 4 (CIT): geocercado real de los talleres aliados.
--
-- Roll-forward sobre la capa CIT ya aplicada. No edita ni recrea migraciones
-- previas: agrega la referencia geografica que faltaba para activar el
-- geocercado real basado en la formula de Haversine.
--
-- Hasta ahora `verificarGeofencing` era un stub que no consultaba ninguna
-- referencia. El intake del CIT necesita comparar las coordenadas levantadas por
-- el mecanico contra la ubicacion registrada del taller aliado emisor. Esta tabla
-- guarda, por aliado (UUID del taller autenticado), su coordenada y el radio
-- permitido alrededor de ella.
--
-- El radio por defecto es 50 m, alineado con el valor por defecto del motor de
-- Haversine. Si un aliado no tiene fila aqui, el intake no puede geocercarse: se
-- registra como "sin referencia" y no levanta `alerta_gps` (no se penaliza al
-- ciclista por una omision de configuracion del taller).

CREATE TABLE IF NOT EXISTS talleres (
  id UUID PRIMARY KEY,                    -- aliado_id (taller autenticado)
  nombre VARCHAR(160),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radio_metros INTEGER NOT NULL DEFAULT 50 CHECK (radio_metros > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT talleres_lat_rango CHECK (lat >= -90 AND lat <= 90),
  CONSTRAINT talleres_lng_rango CHECK (lng >= -180 AND lng <= 180)
);
