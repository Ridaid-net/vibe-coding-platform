-- RODAID — Honestidad hacia el usuario: distinguir anclaje BFA real (ONCHAIN)
-- de anclaje simulado (STUB) en toda superficie que hoy dice "Anclado on-chain"
-- / "Blockchain Federal Argentina" sin distinguir el modo (garaje digital,
-- verificador publico, certificado PDF, credencial verificable W3C, API
-- gubernamental que consultan directamente Ministerio de Seguridad/MPF/
-- municipios).
--
-- Corregido 2026-07-11 (segundo intento, el primero fallo en deploy con
-- 22P02): el WHERE de mas abajo comparaba bfa_estado contra 'anclado' en
-- minuscula, pero el enum real `cit_bfa_estado` solo tiene valores en
-- MAYUSCULA (NO_INICIADA/PENDIENTE/ACUNADO/ERROR/FALLIDO). Esto ademas
-- destapo un hallazgo mas grave, ya corregido por separado en
-- blockchain.service.ts: el codigo de anclaje escribia en minuscula contra
-- este mismo enum, asi que NUNCA anclo un CIT con exito, ni siquiera en
-- modo STUB (verificado empiricamente: los 3 CIT de produccion estaban en
-- NO_INICIADA, con bfa_tx_hash e bfa_intentos en cero). Por eso este
-- backfill hoy no afecta ninguna fila -- queda igual por prolijidad y para
-- cuando el anclaje empiece a funcionar de verdad.

ALTER TABLE cits
  ADD COLUMN IF NOT EXISTS bfa_modo VARCHAR(10) CHECK (bfa_modo IN ('ONCHAIN', 'STUB'));

UPDATE cits SET bfa_modo = 'STUB' WHERE bfa_estado = 'ACUNADO' AND bfa_modo IS NULL;
