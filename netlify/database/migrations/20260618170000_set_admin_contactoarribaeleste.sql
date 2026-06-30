-- Elevar usuario fundador a rol admin para acceso al panel de administracion.
-- Esta migracion se aplica una sola vez; es idempotente por el WHERE.
UPDATE usuarios
SET rol = 'admin', updated_at = NOW()
WHERE lower(email) = 'contactoarribaeleste@gmail.com'
  AND rol = 'ciclista';
