-- RODAID — Limpieza de datos de prueba en produccion (Talleres/Tiendas Aliados).
--
-- Confirmado por Federico: la plataforma no tiene ningun taller real en
-- produccion todavia -- las 9 solicitudes de aliado resueltas (aprobadas o
-- rechazadas) listadas abajo son de desarrollo: nombres de prueba ("Test Logo
-- Email", "Test Logo Inline", "Taller Prueba RODAID"), o cuentas demo-session
-- sin dueno real ("Bikeup", "Bisi mania"), o la cuenta @rodaid.test usada
-- para verificar el gate de aliados.tipo en PR #146 ("Lucas"). Se conserva
-- unicamente "Taller de Prueba RODAID (interno, no publicar)"
-- (id 5b2ed35d-abc3-41a5-859a-e4c08d276c5d) -- pedido explicito de Federico
-- ("deja solo el de mi admin para prueba") y el unico de los 10 aliados
-- resueltos con datos reales vinculados (4 inspecciones_fisicas +
-- 1 pagos_liquidaciones), usado por su cuenta admin para probar el Panel de
-- Inspecciones.
--
-- Confirmado antes de escribir esta migracion, con una consulta de solo
-- lectura contra produccion: ninguno de los 9 aliados borrados tiene fila
-- vinculada en aliado_servicios, talleres, inspecciones_fisicas,
-- escrow_transacciones, pagos_liquidaciones, remitos ni
-- solicitudes_reserva_taller -- DELETE directo, sin necesidad de tocar
-- ninguna otra tabla por estos 9.
DELETE FROM aliados WHERE id IN (
  'a383c03d-f4e1-49a3-b0be-7f0a717d265c', -- Centro Bike
  '4be138ee-5787-43c4-bc61-1befd9ae0966', -- Bikeup
  '4dd75633-a450-4059-b539-19c938135318', -- Taller Prueba RODAID
  '8f59251c-898e-493b-b4cf-da0822e11b9a', -- Esquina Cicles
  'ae4a556a-7df1-4502-81f5-723ada86e6c7', -- Test Logo Email
  '94a44351-09d4-423d-8af8-6c8ee06317c9', -- Test Logo Inline
  'cc475dd2-a5b2-4165-abd8-081ea0f8052b', -- Bicicleteria El Pionero
  '53e1cba8-3c50-494d-b55c-5608701489a1', -- Bisi mania
  '1691a55f-7282-490a-8837-e4706435e2b8'  -- Lucas (cuenta de prueba de PR #146)
);

-- Las 3 cuentas de usuario detras de Bikeup/Bisi mania/Lucas son 100%
-- descartables: dos son cuentas demo-session sin dueno real
-- (demo-xxxx@rodaid.test, creadas automaticamente en algun punto de una
-- prueba anterior, nunca por un login real), la tercera es la cuenta de
-- prueba de PR #146 (@rodaid.test). Confirmado antes de escribir esto: no
-- tienen bicicletas, notificaciones, datos bancarios, identidades federadas
-- ni ninguna otra fila vinculada mas alla de sus propias `sesiones`
-- (ON DELETE CASCADE, se limpian solas con este DELETE).
DELETE FROM usuarios WHERE id IN (
  'e843a0d4-0dea-40f5-a42f-446daf4486ad', -- demo-d6aab1b1-6fc@rodaid.test (Bikeup)
  '93ef9b3c-ea84-4033-a4d7-53f34e4e9499', -- demo-dc899aec-860@rodaid.test (Bisi mania)
  '298e3bed-fda5-4c6c-9c25-f413198b5495'  -- test-tienda-inspecciones@rodaid.test (Lucas)
);
