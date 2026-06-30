-- Forzar rol admin al usuario fundador sin condicion de rol previo.
UPDATE usuarios
SET rol = 'admin'::usuario_rol, updated_at = NOW()
WHERE lower(email) = 'contactoarribaeleste@gmail.com';
