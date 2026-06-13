-- RODAID — Enriquecimiento de los CITs de demostración.
--
-- Migración hacia adelante (NO modifica las migraciones ya aplicadas, que son
-- inmutables). Es puramente aditiva: actualiza datos de demostración ya
-- sembrados y agrega un CIT en BORRADOR; no toca ninguna columna ni estructura.
--
-- Los CITs demo se sembraron en 20260612120000 (antes de que 20260612140000
-- agregara numero_cit, puntos, hash, inspector, etc.), por lo que quedaron sin
-- esos campos. Sin ellos, el Garaje Digital (GET /api/v1/usuario/bicicletas), el
-- estado efectivo del CIT (GET /api/v1/cit/:id) y "mis publicaciones"
-- (GET /api/v1/marketplace/mis-publicaciones) mostraban tarjetas a medias.
--
-- Este seed completa los CITs demo con número, puntaje de inspección, hash del
-- acta, fecha de emisión, propietario e inspector, y añade un CIT en BORRADOR
-- (inspección incompleta) para demostrar todas las ramas del árbol de estado.
-- Es idempotente: las actualizaciones son deterministas y el INSERT usa
-- ON CONFLICT DO NOTHING.

-- ── Nombre del inspector demo (para que el Garaje muestre un inspector real) ──
UPDATE usuarios
   SET nombre = 'Gastón Parra'
 WHERE id = '20000000-0000-0000-0000-000000000004';

-- ── Trek Marlin 7 — CIT activo, 20/20, emitido por inspector ──────────────────
UPDATE cits SET
    numero_cit       = 'RCIT-2026-00041',
    propietario_id   = '20000000-0000-0000-0000-000000000002',
    puntos           = 20,
    hash_sha256      = 'a3f8c1d7e2b4091e5f6a7c8d9e0b1234567890abcdef1234567890abcdef12',
    fecha_emision    = NOW() - INTERVAL '6 days',
    inspector_id     = '70000000-0000-0000-0000-000000000001',
    taller_aliado_id = '30000000-0000-0000-0000-000000000001'
 WHERE id = '50000000-0000-0000-0000-000000000001';

-- ── Specialized Rockhopper — CIT activo, 20/20 ────────────────────────────────
UPDATE cits SET
    numero_cit     = 'RCIT-2026-00039',
    propietario_id = '20000000-0000-0000-0000-000000000002',
    puntos         = 20,
    hash_sha256    = 'b4e9d2c1f3a6781b0c5d8e2f1a3b4c5d6e7f8901234567890abcdef12345678',
    fecha_emision  = NOW() - INTERVAL '7 days'
 WHERE id = '50000000-0000-0000-0000-000000000002';

-- ── Giant TCR Advanced — CIT activo, 18/20 ────────────────────────────────────
UPDATE cits SET
    numero_cit     = 'RCIT-2026-00043',
    propietario_id = '20000000-0000-0000-0000-000000000002',
    puntos         = 18,
    hash_sha256    = 'c5f0e3d2a4b7891c1d6e9f3a2b4c5d6e7f89012345678901abcdef23456789',
    fecha_emision  = NOW() - INTERVAL '9 days'
 WHERE id = '50000000-0000-0000-0000-000000000003';

-- ── Canyon Grail CF — CIT pendiente (en validación), sin puntaje aún ──────────
UPDATE cits SET
    numero_cit     = 'RCIT-2026-00044',
    propietario_id = '20000000-0000-0000-0000-000000000002'
 WHERE id = '50000000-0000-0000-0000-000000000004';

-- ── Cube Attention — CIT en BORRADOR, inspección incompleta (12/20) ───────────
-- `fecha_vencimiento` es NOT NULL en el esquema vivo; un borrador igual recibe
-- un vencimiento futuro de referencia.
INSERT INTO cits
  (id, bicicleta_id, estado, fecha_vencimiento, numero_cit, propietario_id, puntos)
VALUES
  ('50000000-0000-0000-0000-000000000005',
   '40000000-0000-0000-0000-000000000005',
   'BORRADOR',
   NOW() + INTERVAL '365 days',
   'RCIT-2026-00045',
   '20000000-0000-0000-0000-000000000002',
   12)
ON CONFLICT (id) DO NOTHING;
