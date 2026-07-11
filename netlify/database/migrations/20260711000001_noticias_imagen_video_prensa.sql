-- RODAID — Imagen de portada real, video embebido (YouTube/Instagram) y
-- comunicados de prensa en noticias_rodaid.
--
-- imagen_url: URL publica de la imagen subida a Netlify Blobs (subirImagenNoticia
--   en storage.service.ts). Reemplaza el campo del mismo nombre que ya existia
--   en el frontend pero nunca tuvo columna real ni estaba conectado al
--   GET/POST/PATCH (bug encontrado en la auditoria previa).
-- video_url: link crudo (YouTube o Instagram) pegado por el admin, ya validado
--   contra los dominios oficiales antes de guardarse. El iframe de embed se
--   deriva de este valor en cada render (lib/noticias-embed.ts), nunca se
--   persiste el iframe ya armado.
-- es_comunicado_prensa: marca las noticias que ademas se listan en /prensa.
ALTER TABLE noticias_rodaid
  ADD COLUMN IF NOT EXISTS imagen_url TEXT,
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS es_comunicado_prensa BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_noticias_prensa
  ON noticias_rodaid (es_comunicado_prensa, orden)
  WHERE es_comunicado_prensa = true;
