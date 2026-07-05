-- Salidas grupales organizadas por usuarios RODAID
CREATE TABLE IF NOT EXISTS salidas_grupales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizador_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  lugar_encuentro TEXT NOT NULL,
  km_recorrido INTEGER,
  nivel TEXT CHECK (nivel IN ('facil', 'moderado', 'dificil')) DEFAULT 'moderado',
  mapa_link TEXT,
  strava_link TEXT,
  garmin_link TEXT,
  trailforks_link TEXT,
  wikilok_link TEXT,
  estado TEXT CHECK (estado IN ('proxima', 'en_curso', 'completada', 'archivada')) DEFAULT 'proxima',
  max_participantes INTEGER DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salidas_participantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salida_id UUID NOT NULL REFERENCES salidas_grupales(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre_invitado TEXT,
  confirmado BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salidas_fotos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salida_id UUID NOT NULL REFERENCES salidas_grupales(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre_autor TEXT,
  foto_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salidas_comentarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salida_id UUID NOT NULL REFERENCES salidas_grupales(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre_autor TEXT,
  contenido TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salidas_organizador ON salidas_grupales(organizador_id);
CREATE INDEX IF NOT EXISTS idx_salidas_estado ON salidas_grupales(estado);
CREATE INDEX IF NOT EXISTS idx_salidas_fecha ON salidas_grupales(fecha);
CREATE INDEX IF NOT EXISTS idx_salidas_fotos_salida ON salidas_fotos(salida_id);
CREATE INDEX IF NOT EXISTS idx_salidas_comentarios_salida ON salidas_comentarios(salida_id);
