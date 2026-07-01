-- Agrega columna foto_url a la tabla bicicletas para almacenar la URL de la foto
ALTER TABLE bicicletas ADD COLUMN IF NOT EXISTS foto_url TEXT;
