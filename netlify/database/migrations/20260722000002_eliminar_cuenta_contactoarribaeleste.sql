-- RODAID — Eliminacion de cuenta a pedido de Federico, para poder re-registrar
-- el mismo email como ciclista o aliado de prueba en produccion.
--
-- Cuenta: contactoarribaeleste@gmail.com (id d48b487e-4f84-4ffa-918f-342579462834,
-- rol='admin'). Federico conserva acceso de administrador via sus otras dos
-- cuentas admin (federicodegeaceo@rodaid.net, federico2@rodaid.net) -- no
-- queda sin acceso.
--
-- Confirmado con Federico explicitamente ("borra todo, bicis incluidas"):
-- se borran tambien las 2 bicicletas reales vinculadas (Raleigh Mojave 5.0,
-- CIT pendiente; SuperBike City, CIT activo) y todo lo que depende de ellas.
-- bicicletas.propietario_id NO tiene foreign key hacia usuarios -- sin este
-- borrado explicito las bicis quedarian huerfanas en vez de limpiarse solas.
--
-- Verificado con consultas de solo lectura contra produccion antes de
-- escribir esta migracion: el unico dato vinculado, aparte de las 2 bicis y
-- sus 2 CITs, es 1 fila en iot_dispositivos, 2 en cola_validaciones y 1 en
-- oauth_connections. admin_perfiles y sesiones tienen ON DELETE CASCADE
-- sobre usuarios, se limpian solas con el DELETE final.

DELETE FROM cola_validaciones WHERE cit_id IN (
  '660c8d3c-618c-4461-9a21-3bff55ad5393', -- CIT-II2724-5C4456 (Raleigh Mojave 5.0, pendiente)
  '34d5cff0-ce7b-4196-8afe-510deeb22de0'  -- CIT-04491X-EBAEB6 (SuperBike City, activo)
);

DELETE FROM iot_dispositivos WHERE bicicleta_id IN (
  '571ee708-0ee2-4617-93bf-b929b4775a0f', -- Raleigh Mojave 5.0
  'b7b774e5-ba01-46d0-8838-229bde518ebe'  -- SuperBike City
);

DELETE FROM cits WHERE id IN (
  '660c8d3c-618c-4461-9a21-3bff55ad5393',
  '34d5cff0-ce7b-4196-8afe-510deeb22de0'
);

DELETE FROM bicicletas WHERE id IN (
  '571ee708-0ee2-4617-93bf-b929b4775a0f',
  'b7b774e5-ba01-46d0-8838-229bde518ebe'
);

DELETE FROM oauth_connections WHERE user_id = 'd48b487e-4f84-4ffa-918f-342579462834';

-- admin_perfiles y sesiones tienen ON DELETE CASCADE, se borran solas aca.
DELETE FROM usuarios WHERE id = 'd48b487e-4f84-4ffa-918f-342579462834';
