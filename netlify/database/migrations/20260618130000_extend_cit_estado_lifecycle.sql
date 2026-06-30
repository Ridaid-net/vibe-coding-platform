-- RODAID — Modulo 4: completar enum cit_estado con los 7 estados del ciclo de vida.
--
-- La migracion 20260618120000_create_cit_identidad creo el enum con 4 valores.
-- Esta migracion agrega los 3 estados faltantes de forma aditiva e idempotente.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TYPE cit_estado ADD VALUE IF NOT EXISTS 'PROCESANDO_CRUCE';
ALTER TYPE cit_estado ADD VALUE IF NOT EXISTS 'ANOMALIA_DETECTADA';
ALTER TYPE cit_estado ADD VALUE IF NOT EXISTS 'RECHAZADO';
