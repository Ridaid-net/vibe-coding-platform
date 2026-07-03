-- Re-aplicar columnas faltantes en produccion
ALTER TABLE bicicletas ADD COLUMN IF NOT EXISTS foto_url TEXT;
ALTER TABLE bicicletas ADD COLUMN IF NOT EXISTS talle_cuadro VARCHAR(20);
