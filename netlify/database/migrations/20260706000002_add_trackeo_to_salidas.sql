ALTER TABLE salidas_grupales ADD COLUMN IF NOT EXISTS trackeo_url TEXT;
ALTER TABLE salidas_grupales ADD COLUMN IF NOT EXISTS trackeo_tipo TEXT DEFAULT 'gpx';
ALTER TABLE salidas_grupales ADD COLUMN IF NOT EXISTS trackeo_nombre TEXT;
