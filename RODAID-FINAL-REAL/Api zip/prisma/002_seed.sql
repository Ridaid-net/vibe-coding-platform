-- ═══════════════════════════════════════════════════════════
-- RODAID · Seed de datos iniciales
-- ═══════════════════════════════════════════════════════════

-- ── 1. Planes de suscripción ──────────────────────────────
INSERT INTO planes (id, nombre, precio_usd, cit_limite, features) VALUES
  ('00000000-0000-0000-0000-000000000001', 'libre',    0,    1,    ARRAY['Verificador público','Perfil básico']),
  ('00000000-0000-0000-0000-000000000002', 'estandar', 10,   1,    ARRAY['1 CIT activo','Marketplace','Denuncia instantánea','Alertas tricanal','Descarga PDF']),
  ('00000000-0000-0000-0000-000000000003', 'premium',  18,   NULL, ARRAY['CITs ilimitados','Bóveda Digital NFT','RODAID PAY','RODAID-GPT','A domicilio','Mapa de calor'])
ON CONFLICT (nombre) DO NOTHING;

-- ── 2. Talleres Aliados demo ──────────────────────────────
INSERT INTO talleres_aliados (id, nombre, direccion, localidad, lat, lng, plan_aliado) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Taller Andes Bikes',    'Av. San Martín 420',   'San Martín', -33.0805, -68.4691, 'fundador'),
  ('10000000-0000-0000-0000-000000000002', 'Ciclos del Este',       'Ruta 7 Km 1080',       'Junín',      -33.1430, -68.4637, 'plus'),
  ('10000000-0000-0000-0000-000000000003', 'Rivadavia Bike Center', 'Calle Las Heras 210',  'Rivadavia',  -33.1842, -68.4556, 'base')
ON CONFLICT DO NOTHING;

-- ── 3. Admin RODAID ───────────────────────────────────────
INSERT INTO usuarios (id, email, password_hash, nombre, apellido, rol, plan_id, mxm_verificado, mxm_nivel) VALUES
  ('20000000-0000-0000-0000-000000000001',
   'admin@rodaid.com.ar',
   crypt('rodaid_admin_2026!', gen_salt('bf', 12)),
   'RODAID', 'Admin', 'ADMIN',
   '00000000-0000-0000-0000-000000000003',
   FALSE, 0)
ON CONFLICT (email) DO NOTHING;

-- ── 4. Usuario ciclista demo — Federico De Gea ────────────
INSERT INTO usuarios (id, email, password_hash, nombre, apellido, dni, cuil, telefono, rol, plan_id, mxm_verificado, mxm_nivel) VALUES
  ('20000000-0000-0000-0000-000000000002',
   'federico@rodaid.com.ar',
   crypt('ciclista_demo_2026', gen_salt('bf', 12)),
   'Federico', 'De Gea',
   '30123456', '20-30123456-7', '+54 264 XXX-XXXX',
   'CICLISTA',
   '00000000-0000-0000-0000-000000000003',
   TRUE, 2)
ON CONFLICT (email) DO NOTHING;

-- ── 5. Usuario inspector demo ─────────────────────────────
INSERT INTO usuarios (id, email, password_hash, nombre, apellido, rol, plan_id) VALUES
  ('20000000-0000-0000-0000-000000000003',
   'inspector@taller-andes.com.ar',
   crypt('inspector_demo_2026', gen_salt('bf', 12)),
   'Carlos', 'Méndez',
   'INSPECTOR',
   '00000000-0000-0000-0000-000000000002')
ON CONFLICT (email) DO NOTHING;

-- ── 6. Inspector vinculado al taller ─────────────────────
INSERT INTO inspectores (id, usuario_id, taller_aliado_id, certificado) VALUES
  ('30000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   TRUE)
ON CONFLICT DO NOTHING;

-- ── 7. Bicicletas del perfil Federico ─────────────────────
INSERT INTO bicicletas (id, propietario_id, numero_serie, marca, modelo, anio, tipo, color) VALUES
  ('40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002',
   'SN-R84MK-TMIA-MZA', 'Trek', 'Marlin 7', 2022, 'MTB', 'Gris Grafito'),

  ('40000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000002',
   'SN-9923410056-MZA', 'Specialized', 'Rockhopper', 2021, 'MTB', 'Negro / Verde'),

  ('40000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000002',
   'SN-GTC2023-RTA', 'Giant', 'TCR Advanced', 2023, 'RUTA', 'Azul Teal'),

  ('40000000-0000-0000-0000-000000000004',
   '20000000-0000-0000-0000-000000000002',
   'SN-CGF2024-RTA', 'Canyon', 'Grail CF', 2024, 'GRAVEL', 'Blanco'),

  ('40000000-0000-0000-0000-000000000005',
   '20000000-0000-0000-0000-000000000002',
   'SN-CA2023-MTB', 'Cube', 'Attention', 2023, 'MTB', 'Gris')
ON CONFLICT (numero_serie) DO NOTHING;

-- ── 8. CITs activos ───────────────────────────────────────
INSERT INTO cits (
  id, numero_cit, bicicleta_id, propietario_id, inspector_id,
  taller_aliado_id, estado, puntos, punto_detalle, hash_sha256,
  bfa_tx_hash, nft_token_id, firma_inspector,
  dj_firmada, dj_firmada_en, fecha_emision, fecha_vencimiento, km_auditados
) VALUES
  -- CIT #1: Trek Marlin 7 — ACTIVO en Marketplace
  ('50000000-0000-0000-0000-000000000001',
   'RCIT-2026-00001',
   '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'ACTIVO', 20,
   '{"serial":true,"cuadro":true,"horquilla":true,"manubrio":true,"freno_delantero":true,"freno_trasero":true,"cables":true,"cambio_delantero":true,"cambio_trasero":true,"cassette":true,"cadena":true,"bielas":true,"pedales":true,"rueda_delantera":true,"rueda_trasera":true,"cubiertas":true,"asiento":true,"luces":true,"accesorios":true,"prueba_funcional":true}'::jsonb,
   '0x14b286075f3d92c4e8a1b7f0d3e9c5a2b8f4d1e6c9a3b7f2e8d5c1a4b9e3f7d0',
   '0xf3a9b2c7d5e1f8a4b6c3d9e2f7a5b1c8d4e6f2a9b5c7d3e8f1a6b2c9d4e7f3',
   1247,
   'RODAID_SIGN_2026_CARLOS_MENDEZ_SHA256_BASE64_PKCS7_DETACHED',
   TRUE, NOW() - INTERVAL '8 days',
   NOW() - INTERVAL '6 days', NOW() + INTERVAL '359 days',
   1247),

  -- CIT #2: Specialized Rockhopper — ACTIVO en Marketplace
  ('50000000-0000-0000-0000-000000000002',
   'RCIT-2026-00002',
   '40000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'ACTIVO', 20,
   '{"serial":true,"cuadro":true,"horquilla":true,"manubrio":true,"freno_delantero":true,"freno_trasero":true,"cables":true,"cambio_delantero":true,"cambio_trasero":true,"cassette":true,"cadena":true,"bielas":true,"pedales":true,"rueda_delantera":true,"rueda_trasera":true,"cubiertas":true,"asiento":true,"luces":true,"accesorios":true,"prueba_funcional":true}'::jsonb,
   '0xa9f3c128b7e4d5f1c6e9a3b2d8f5c7e1a4b9f3d6c2e8a5b1f7d4c9e3b6a2f8',
   '0xb8c4d9e2f1a7b5c3d6e9f4a2b8c5d1e7f3a9b4c6d2e8f5a1b7c3d9e6f2a8b4',
   1248,
   'RODAID_SIGN_2026_CARLOS_MENDEZ_SHA256_BASE64_PKCS7_DETACHED',
   TRUE, NOW() - INTERVAL '9 days',
   NOW() - INTERVAL '7 days', NOW() + INTERVAL '358 days',
   892),

  -- CIT #3: Giant TCR Advanced — ACTIVO, no en Marketplace
  ('50000000-0000-0000-0000-000000000003',
   'RCIT-2026-00003',
   '40000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'ACTIVO', 20,
   '{"serial":true,"cuadro":true,"horquilla":true,"manubrio":true,"freno_delantero":true,"freno_trasero":true,"cables":true,"cambio_delantero":true,"cambio_trasero":true,"cassette":true,"cadena":true,"bielas":true,"pedales":true,"rueda_delantera":true,"rueda_trasera":true,"cubiertas":true,"asiento":true,"luces":true,"accesorios":true,"prueba_funcional":true}'::jsonb,
   '0xd7e3a1b9f5c2d8e6a4b1c7f9d3e5a8b2f4c6d1e9a5b3c8f2d6e4a9b7c1f5d3',
   '0xe1f7a3b9c5d2e8f4a6b1c7d3e9f5a2b8c4d6e1f9a3b5c2d8f4a9e6b1c7d3f5',
   1249,
   'RODAID_SIGN_2026_CARLOS_MENDEZ_SHA256_BASE64_PKCS7_DETACHED',
   TRUE, NOW() - INTERVAL '11 days',
   NOW() - INTERVAL '9 days', NOW() + INTERVAL '356 days',
   2100),

  -- CIT #4: Canyon Grail — PENDIENTE (en validación 72 hs)
  ('50000000-0000-0000-0000-000000000004',
   'RCIT-2026-00004',
   '40000000-0000-0000-0000-000000000004',
   '20000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'PENDIENTE', 15,
   '{"serial":true,"cuadro":true,"horquilla":true,"manubrio":true,"freno_delantero":true,"freno_trasero":true,"cables":true,"cambio_delantero":true,"cambio_trasero":false,"cassette":true,"cadena":true,"bielas":true,"pedales":true,"rueda_delantera":true,"rueda_trasera":true,"cubiertas":false,"asiento":true,"luces":false,"accesorios":false,"prueba_funcional":true}'::jsonb,
   '0xf2c8d4e1a7b3f9c5d2e8a4b6f1c7d3e9a5b2f8c4d6e3a9b1f7c2d8e5a3b9f4',
   NULL, NULL,
   'RODAID_SIGN_2026_CARLOS_MENDEZ_SHA256_BASE64_PKCS7_DETACHED',
   TRUE, NOW() - INTERVAL '2 hours',
   NULL, NULL, 340)
ON CONFLICT DO NOTHING;

-- ── 9. Cola de validación para el CIT pendiente ───────────
INSERT INTO validacion_queue (cit_id, serial_bicicleta, propietario_dni, propietario_nombre, propietario_datos, vence_en) VALUES
  ('50000000-0000-0000-0000-000000000004',
   'SN-CGF2024-RTA',
   '30123456',
   'Federico De Gea',
   '{"foto": null, "lat": -33.0805, "lng": -68.4691, "telefono": "+54264XXXXXXX"}'::jsonb,
   NOW() + INTERVAL '70 hours')
ON CONFLICT DO NOTHING;

-- ── 10. Publicaciones en el Marketplace ──────────────────
INSERT INTO publicaciones (id, vendedor_id, bicicleta_id, titulo, descripcion, precio_ars, estado) VALUES
  ('60000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002',
   '40000000-0000-0000-0000-000000000001',
   'Trek Marlin 7 2022 — CIT activo · excelente estado',
   'MTB Trek Marlin 7 del año 2022. Frenos hidráulicos Shimano MT200, horquilla SR Suntour XCT de 100mm. Con CIT activo RODAID verificado en BFA. Ideal para trails y rutas de montaña. 1247 km auditados.',
   450000, 'ACTIVA'),

  ('60000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000002',
   '40000000-0000-0000-0000-000000000002',
   'Specialized Rockhopper 2021 — CIT verificado BFA',
   'MTB Specialized Rockhopper 2021 en perfecto estado. Cambios Shimano Deore, llantas WTB ST i25. CIT activo con 20/20 puntos de inspección técnica. 892 km auditados por inspector certificado RODAID.',
   380000, 'ACTIVA')
ON CONFLICT DO NOTHING;

-- ── 11. Notificaciones de ejemplo ─────────────────────────
INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, leida) VALUES
  ('20000000-0000-0000-0000-000000000002',
   'CIT_APROBADO',
   'CIT Nº RCIT-2026-00001 activado',
   'Tu Trek Marlin 7 ya tiene certificado activo. El NFT fue acuñado en la Blockchain Federal Argentina.',
   TRUE),
  ('20000000-0000-0000-0000-000000000002',
   'CIT_APROBADO',
   'CIT Nº RCIT-2026-00002 activado',
   'Tu Specialized Rockhopper ya tiene certificado activo. Podés publicarlo en el Marketplace.',
   TRUE);

-- ── Verificación final ────────────────────────────────────
DO $$
DECLARE
  n_planes       INT; n_talleres   INT; n_usuarios INT;
  n_inspectores  INT; n_bicicletas INT; n_cits     INT;
  n_publi        INT; n_vq         INT;
BEGIN
  SELECT COUNT(*) INTO n_planes      FROM planes;
  SELECT COUNT(*) INTO n_talleres    FROM talleres_aliados;
  SELECT COUNT(*) INTO n_usuarios    FROM usuarios;
  SELECT COUNT(*) INTO n_inspectores FROM inspectores;
  SELECT COUNT(*) INTO n_bicicletas  FROM bicicletas;
  SELECT COUNT(*) INTO n_cits        FROM cits;
  SELECT COUNT(*) INTO n_publi       FROM publicaciones;
  SELECT COUNT(*) INTO n_vq          FROM validacion_queue;

  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'RODAID · Seed completado exitosamente';
  RAISE NOTICE '──────────────────────────────────────────';
  RAISE NOTICE 'Planes         : %', n_planes;
  RAISE NOTICE 'Talleres Aliados: %', n_talleres;
  RAISE NOTICE 'Usuarios        : %', n_usuarios;
  RAISE NOTICE 'Inspectores     : %', n_inspectores;
  RAISE NOTICE 'Bicicletas      : %', n_bicicletas;
  RAISE NOTICE 'CITs            : %', n_cits;
  RAISE NOTICE 'Publicaciones   : %', n_publi;
  RAISE NOTICE 'Cola validación : %', n_vq;
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
