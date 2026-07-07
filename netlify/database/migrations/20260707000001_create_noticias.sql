CREATE TABLE IF NOT EXISTS noticias_rodaid (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo VARCHAR(200) NOT NULL,
  resumen TEXT NOT NULL,
  url TEXT,
  fuente VARCHAR(100) DEFAULT 'RODAID',
  tipo VARCHAR(20) DEFAULT 'noticia' CHECK (tipo IN ('noticia', 'prensa', 'evento')),
  activa BOOLEAN DEFAULT true,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_noticias_activa ON noticias_rodaid(activa, orden);

-- Datos iniciales
INSERT INTO noticias_rodaid (titulo, resumen, url, fuente, tipo, orden) VALUES
  ('RODAID presenta su API Gubernamental Multi-Tenant', 'La plataforma integra 9 endpoints para el Ministerio de Seguridad, MPF y municipios de Mendoza bajo el estándar EDI X-Road.', 'https://rodaid.net/sobre', 'RODAID · Blog', 'noticia', 1),
  ('Intendente Mario Abed valida RODAID en Junín', 'El Municipio de Junín propone fortalecer la Ley 9556 y crear un puente con el Ministerio de Seguridad para interoperabilidad policial.', 'https://rodaid.net/sobre', 'Municipalidad de Junín', 'prensa', 2),
  ('CIT blockchain: la identidad digital de tu bicicleta', 'Cada certificado queda anclado en la Blockchain Federal Argentina con hash SHA-256, garantizando trazabilidad e inmutabilidad.', 'https://rodaid.net/verificar', 'RODAID · Novedades', 'noticia', 3)
ON CONFLICT DO NOTHING;
