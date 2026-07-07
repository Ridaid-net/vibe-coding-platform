CREATE TABLE IF NOT EXISTS valoraciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  autor_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  destinatario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  publicacion_id UUID REFERENCES publicaciones(id) ON DELETE SET NULL,
  puntuacion INTEGER NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
  comentario TEXT,
  tipo TEXT CHECK (tipo IN ('comprador', 'vendedor')) DEFAULT 'comprador',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(autor_id, destinatario_id, publicacion_id)
);
CREATE INDEX IF NOT EXISTS idx_valoraciones_destinatario ON valoraciones(destinatario_id);
CREATE INDEX IF NOT EXISTS idx_valoraciones_autor ON valoraciones(autor_id);
