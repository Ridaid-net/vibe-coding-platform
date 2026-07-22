-- RODAID — Vincula manualmente la solicitud de aliado "Collarbike" a la
-- cuenta real de Federico y promueve su rol.
--
-- Causa raiz (no un bug de codigo nuevo): la solicitud se envio SIN sesion
-- (probando el fix de PR #154, solicitarAliado() para visitantes anonimos),
-- asi que quedo con usuario_id = NULL. Al aprobarla desde el admin panel,
-- resolverAliado() solo promueve el rol de la cuenta vinculada -- como no
-- habia ninguna, la cuenta contactoarribaeleste@gmail.com se quedo en
-- rol='ciclista' pese a que la solicitud dice 'aprobado'.
--
-- Aliado: id 62419d64-42ea-43f2-b38a-242e68827190 ("Collarbike", tipo=taller,
-- estado=aprobado, usuario_id NULL).
-- Usuario: id 7b63e01d-bfb2-450e-8095-2f7a0b0ce808
-- (contactoarribaeleste@gmail.com, rol=ciclista).

UPDATE aliados
SET usuario_id = '7b63e01d-bfb2-450e-8095-2f7a0b0ce808', updated_at = NOW()
WHERE id = '62419d64-42ea-43f2-b38a-242e68827190';

-- Mismo criterio que resolverAliado() al aprobar: solo promueve desde
-- 'ciclista' (defensa en profundidad si el rol ya cambio por otra via).
UPDATE usuarios
SET rol = 'aliado'::usuario_rol, updated_at = NOW()
WHERE id = '7b63e01d-bfb2-450e-8095-2f7a0b0ce808' AND rol = 'ciclista';
