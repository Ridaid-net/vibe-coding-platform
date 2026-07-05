-- Otorga el rol 'admin' a federicodegeaceo@rodaid.net.
--
-- Por que no un INSERT directo (como pedia el SQL original):
--   * `usuarios` no tiene UNIQUE sobre `email`; la unicidad la impone el indice
--     de expresion `idx_usuarios_email_lower` sobre lower(email). Un
--     `ON CONFLICT (email)` no encuentra restriccion y falla.
--   * El CHECK `usuarios_credencial_valida` exige `password_hash` para las
--     cuentas locales (proveedor='local'). Insertar una fila solo con
--     id/email/rol viola ese CHECK y, ademas, produciria una cuenta sin
--     credencial e imposible de usar (no existe alta ni reseteo de contrasena
--     fuera del registro publico).
--
-- Por eso seguimos el mismo patron que las migraciones del usuario fundador:
-- elevar el rol de la cuenta, no fabricar una credencial. Todo es idempotente.

-- 1) Si la cuenta ya existe (registrada por el flujo publico), elevarla ahora.
UPDATE usuarios
SET rol = 'admin'::usuario_rol, updated_at = NOW()
WHERE lower(email) = 'federicodegeaceo@rodaid.net'
  AND rol <> 'admin'::usuario_rol;

-- 2) Si todavia no existe, dejar que quede admin en cuanto se registre. El
--    registro crea la cuenta con su contrasena (satisface el CHECK) y este
--    trigger la marca como administradora, sin pasos manuales adicionales.
CREATE OR REPLACE FUNCTION rodaid_auto_admin_federicodegeaceo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(NEW.email) = 'federicodegeaceo@rodaid.net' THEN
    NEW.rol := 'admin'::usuario_rol;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_admin_federicodegeaceo ON usuarios;
CREATE TRIGGER trg_auto_admin_federicodegeaceo
  BEFORE INSERT OR UPDATE OF email ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION rodaid_auto_admin_federicodegeaceo();
