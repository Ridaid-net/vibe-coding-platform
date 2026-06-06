DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marketplace_publicacion_estado') THEN
    CREATE TYPE marketplace_publicacion_estado AS ENUM (
      'ACTIVA',
      'PAUSADA',
      'VENDIDA',
      'CANCELADA',
      'RECHAZADA'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS marketplace_publicaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cit_id UUID NOT NULL,
  bicicleta_id UUID NOT NULL,
  vendedor_id UUID NOT NULL,
  titulo VARCHAR(120) NOT NULL,
  descripcion TEXT NOT NULL,
  precio_ars NUMERIC(12,2) NOT NULL CHECK (precio_ars > 0),
  precio_usd NUMERIC(10,2),
  fotos_urls TEXT[] NOT NULL DEFAULT '{}',
  estado marketplace_publicacion_estado NOT NULL DEFAULT 'ACTIVA',
  slug VARCHAR(220) NOT NULL UNIQUE,
  vistas INTEGER NOT NULL DEFAULT 0 CHECK (vistas >= 0),
  contactos INTEGER NOT NULL DEFAULT 0 CHECK (contactos >= 0),
  publicado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vence_en TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  vendido_en TIMESTAMPTZ,
  comprador_id UUID,
  precio_final_ars NUMERIC(12,2),
  comision_rodaid NUMERIC(10,2),
  search_vector TSVECTOR NOT NULL DEFAULT ''::tsvector,
  CONSTRAINT marketplace_publicaciones_precio_usd_positive
    CHECK (precio_usd IS NULL OR precio_usd > 0),
  CONSTRAINT marketplace_publicaciones_precio_final_positive
    CHECK (precio_final_ars IS NULL OR precio_final_ars > 0),
  CONSTRAINT marketplace_publicaciones_comision_positive
    CHECK (comision_rodaid IS NULL OR comision_rodaid >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_publicaciones_unica_activa_por_cit
  ON marketplace_publicaciones (cit_id)
  WHERE estado IN ('ACTIVA', 'PAUSADA');

CREATE INDEX IF NOT EXISTS idx_mp_publicaciones_search_vector
  ON marketplace_publicaciones
  USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_mp_publicaciones_estado_publicado
  ON marketplace_publicaciones (estado, publicado_en DESC);

CREATE INDEX IF NOT EXISTS idx_mp_publicaciones_precio_ars
  ON marketplace_publicaciones (precio_ars);

CREATE INDEX IF NOT EXISTS idx_mp_publicaciones_vendedor
  ON marketplace_publicaciones (vendedor_id);

CREATE OR REPLACE FUNCTION mp_update_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  bicicleta_record RECORD;
BEGIN
  SELECT marca, modelo, numero_serie
  INTO bicicleta_record
  FROM bicicletas
  WHERE id = NEW.bicicleta_id;

  NEW.search_vector :=
    to_tsvector(
      'spanish',
      concat_ws(
        ' ',
        NEW.titulo,
        NEW.descripcion,
        bicicleta_record.marca,
        bicicleta_record.modelo,
        bicicleta_record.numero_serie
      )
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mp_search_vector ON marketplace_publicaciones;

CREATE TRIGGER trg_mp_search_vector
  BEFORE INSERT OR UPDATE OF titulo, descripcion, bicicleta_id
  ON marketplace_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION mp_update_search_vector();
