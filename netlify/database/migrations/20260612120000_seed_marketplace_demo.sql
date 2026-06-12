-- RODAID — Datos de demostración del Marketplace.
--
-- Migración hacia adelante (NO modifica las migraciones ya aplicadas, que son
-- inmutables). Las tablas base `bicicletas`, `cits` y `marketplace_publicaciones`
-- existían pero estaban vacías, por lo que el listado, la búsqueda y los flujos
-- de compra/escrow no tenían nada contra qué operar tras el deploy.
--
-- Este seed carga el dataset de demostración de RODAID (los rodados de Federico
-- De Gea, sus CITs y dos publicaciones activas) adaptado EXACTAMENTE a las
-- columnas reales del esquema vivo del proyecto Netlify. Es idempotente: usa IDs
-- fijos con ON CONFLICT DO NOTHING, de modo que reaplicarlo no duplica filas.
--
-- El identificador del vendedor (20000000-…-0002) es el `sub` que portan los
-- JWT de RODAID; coincide con `vendedor_id` para que las publicaciones aparezcan
-- como propias del usuario demo.

-- ── Rodados registrados ───────────────────────────────────
INSERT INTO bicicletas (id, propietario_id, marca, modelo, anio, tipo, numero_serie) VALUES
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Trek',        'Marlin 7',     2022, 'MTB',    'SN-R84MK-TMIA-MZA'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Specialized', 'Rockhopper',   2021, 'MTB',    'SN-9923410056-MZA'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'Giant',       'TCR Advanced', 2023, 'RUTA',   'SN-GTC2023-RTA'),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'Canyon',      'Grail CF',     2024, 'GRAVEL', 'SN-CGF2024-RTA'),
  ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', 'Cube',        'Attention',    2023, 'MTB',    'SN-CA2023-MTB')
ON CONFLICT (id) DO NOTHING;

-- ── Certificados de Identificación (CIT) ──────────────────
-- Un CIT ACTIVO por cada rodado publicable; el Canyon Grail queda PENDIENTE
-- (en validación). `fecha_vencimiento` es NOT NULL en el esquema vivo, así que
-- el pendiente recibe igualmente un vencimiento futuro.
INSERT INTO cits (id, bicicleta_id, estado, fecha_vencimiento) VALUES
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'ACTIVO',    NOW() + INTERVAL '359 days'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'ACTIVO',    NOW() + INTERVAL '358 days'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'ACTIVO',    NOW() + INTERVAL '356 days'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 'PENDIENTE', NOW() + INTERVAL '70 days')
ON CONFLICT (id) DO NOTHING;

-- ── Publicaciones activas del Marketplace ─────────────────
-- `search_vector` lo completa automáticamente el trigger trg_mp_search_vector,
-- que lee marca/modelo/numero_serie de las bicicletas ya insertadas arriba.
INSERT INTO marketplace_publicaciones
  (id, cit_id, bicicleta_id, vendedor_id, titulo, descripcion, precio_ars, slug, estado) VALUES
  ('60000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002',
   'Trek Marlin 7 2022 — CIT activo · excelente estado',
   'MTB Trek Marlin 7 del año 2022. Frenos hidráulicos Shimano MT200, horquilla SR Suntour XCT de 100mm. Con CIT activo RODAID verificado en BFA. Ideal para trails y rutas de montaña. 1247 km auditados.',
   450000,
   'trek-marlin-7-2022-cit-activo',
   'ACTIVA'),
  ('60000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000002',
   '40000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000002',
   'Specialized Rockhopper 2021 — CIT verificado BFA',
   'MTB Specialized Rockhopper 2021 en perfecto estado. Cambios Shimano Deore, llantas WTB ST i25. CIT activo con 20/20 puntos de inspección técnica. 892 km auditados por inspector certificado RODAID.',
   380000,
   'specialized-rockhopper-2021-cit-verificado',
   'ACTIVA')
ON CONFLICT (id) DO NOTHING;
