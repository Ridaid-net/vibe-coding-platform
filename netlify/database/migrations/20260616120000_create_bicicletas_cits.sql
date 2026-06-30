-- RODAID — Hito 0: desbloquear el marketplace.
-- Crea las tablas `bicicletas` (rodado + configuracion tecnica del cuadro) y
-- `cits` (Cedula de Identidad de la bici), ambas referenciadas por la Fase A
-- (`marketplace_publicaciones`, el trigger `mp_update_search_vector` y los
-- endpoints GET /api/v1/marketplace y POST /api/v1/marketplace/publicar) pero
-- que aun no existian, lo que mantenia el listado en HTTP 500.
--
-- Roll-forward: no toca ninguna migracion ya aplicada.

-- Estado de verificacion del CIT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'pendiente',
      'activo',
      'bloqueado',
      'rechazado'
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- bicicletas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bicicletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marca VARCHAR(80) NOT NULL,
  modelo VARCHAR(120) NOT NULL,
  -- Numero de serie del cuadro: identificador fisico, indexado y unico.
  numero_serie VARCHAR(120) NOT NULL,
  -- Tipo de rodado: ruta, MTB, urbana, gravel, etc. (abierto, no enum estricto).
  tipo VARCHAR(40) NOT NULL,
  anio INTEGER CHECK (anio IS NULL OR (anio >= 1950 AND anio <= 2100)),
  color VARCHAR(40),
  foto_url TEXT,
  -- FK logica a usuarios. La tabla `usuarios` se crea en el Hito 1; por eso aqui
  -- es solo una columna indexada y todavia NO una FOREIGN KEY (evita romper la
  -- migracion por una tabla inexistente).
  propietario_id UUID NOT NULL,

  -- Configuracion tecnica del cuadro --------------------------------------
  -- Rodado de la rueda. NUMERIC para admitir 27.5 ademas de los enteros
  -- clasicos (12, 16, 20, 24, 26, 29) y el formato de ruta (700).
  rodado NUMERIC(4, 1)
    CHECK (rodado IS NULL OR rodado IN (12, 16, 20, 24, 26, 27.5, 29, 700)),
  -- Talle del cuadro como categoria de indumentaria.
  talle_cuadro VARCHAR(4)
    CHECK (talle_cuadro IS NULL OR talle_cuadro IN ('S', 'M', 'L', 'XL')),
  -- Medida del cuadro expresada en pulgadas y en centimetros (DECIMAL).
  medida_cuadro_pulgadas DECIMAL(4, 1)
    CHECK (medida_cuadro_pulgadas IS NULL OR medida_cuadro_pulgadas > 0),
  medida_cuadro_cm DECIMAL(5, 1)
    CHECK (medida_cuadro_cm IS NULL OR medida_cuadro_cm > 0),

  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- numero_serie indexado y unico.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bicicletas_numero_serie
  ON bicicletas (numero_serie);

-- Indices de apoyo para el propietario y para las facetas del marketplace.
CREATE INDEX IF NOT EXISTS idx_bicicletas_propietario
  ON bicicletas (propietario_id);

CREATE INDEX IF NOT EXISTS idx_bicicletas_tipo
  ON bicicletas (tipo);

CREATE INDEX IF NOT EXISTS idx_bicicletas_rodado
  ON bicicletas (rodado);

CREATE INDEX IF NOT EXISTS idx_bicicletas_talle_cuadro
  ON bicicletas (talle_cuadro);

-- ---------------------------------------------------------------------------
-- cits — Cedula de Identidad de la bicicleta (identidad verificada)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  estado cit_estado NOT NULL DEFAULT 'pendiente',
  -- Codigo CIT legible y unico que identifica la cedula.
  codigo_cit VARCHAR(40) NOT NULL,
  -- Huella SHA-256 del documento/identidad de la bici (64 hex chars).
  hash_sha256 VARCHAR(64),
  -- Metadatos flexibles de la verificacion (origen, peritaje, fotos, etc.).
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Vencimiento de la cedula; usado por `publicar` para rechazar CITs vencidos.
  fecha_vencimiento TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year'),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_codigo_cit
  ON cits (codigo_cit);

CREATE INDEX IF NOT EXISTS idx_cits_bicicleta
  ON cits (bicicleta_id);

CREATE INDEX IF NOT EXISTS idx_cits_estado
  ON cits (estado);
