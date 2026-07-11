-- RODAID — Honestidad hacia el usuario: distinguir anclaje BFA real (ONCHAIN)
-- de anclaje simulado (STUB) en toda superficie que hoy dice "Anclado on-chain"
-- / "Blockchain Federal Argentina" sin distinguir el modo (garaje digital,
-- verificador publico, certificado PDF, credencial verificable W3C, API
-- gubernamental que consultan directamente Ministerio de Seguridad/MPF/
-- municipios).
--
-- Confirmado 2026-07-11: NINGUNA de las 3 variables necesarias para ONCHAIN
-- (BFA_RPC_URL, BFA_PRIVATE_KEY, BFA_CIT_CONTRACT) esta configurada en
-- produccion, asi que TODO CIT anclado hasta hoy fue en modo STUB (simulado,
-- txHash calculado localmente con sha256, sin ninguna llamada de red) --
-- backfill trivial, sin ambiguedad.

ALTER TABLE cits
  ADD COLUMN IF NOT EXISTS bfa_modo VARCHAR(10) CHECK (bfa_modo IN ('ONCHAIN', 'STUB'));

UPDATE cits SET bfa_modo = 'STUB' WHERE bfa_estado = 'anclado' AND bfa_modo IS NULL;
