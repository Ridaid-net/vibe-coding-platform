-- RODAID — Reset de contrasena a pedido de Federico: no podia entrar a la
-- cuenta admin federicodegeaceo@rodaid.net (email + contrasena, sin CUIL).
--
-- Investigado antes de este reset: la cuenta esta sana (estado=activo,
-- proveedor=local, cuil sin duplicar en toda la tabla, sin
-- sesion_invalidada_desde, password_hash con formato scrypt valido desde
-- 2026-07-21). El backend devolvia 401 CREDENCIALES_INVALIDAS real -- la
-- contrasena tipeada no matcheaba el hash guardado. Sin flujo de "olvide mi
-- contrasena" en el repo, el reset se hace via migracion (mismo mecanismo ya
-- usado toda la sesion para cambios de datos en produccion) y la contrasena
-- nueva se entrega directo a Federico -- quien debe cambiarla el mismo dia
-- via POST /api/v1/auth/cambiar-password (endpoint ya existente).
--
-- Usuario: id b60c1f70-66e7-4193-b6ad-5f7bcf0726a0 (federicodegeaceo@rodaid.net).

UPDATE usuarios
SET password_hash = 'scrypt$16384$8$1$71mPU8zzewUAHgC2UNQCMQ==$XDsPr3QlWQ7y9dpuAm6jApUM9JCHb4AbgfiIg+9woGwX5PmEOOZe7+8DX5xYE3liTUc0EYXjc/M6ifhb9Qsrxg==',
    updated_at = NOW()
WHERE id = 'b60c1f70-66e7-4193-b6ad-5f7bcf0726a0';
