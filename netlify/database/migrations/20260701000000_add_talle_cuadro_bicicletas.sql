-- Agrega columna talle_cuadro que faltó en la recreación de la tabla bicicletas
ALTER TABLE bicicletas 
  ADD COLUMN IF NOT EXISTS talle_cuadro VARCHAR(4) 
  CHECK (talle_cuadro IS NULL OR talle_cuadro IN ('S', 'M', 'L', 'XL'));

CREATE INDEX IF NOT EXISTS idx_bicicletas_talle_cuadro
  ON bicicletas (talle_cuadro);
