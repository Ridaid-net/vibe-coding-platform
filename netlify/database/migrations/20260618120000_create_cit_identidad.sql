-- RODAID — Modulo 4 (parte 1/3): tipos ENUM del CIT.
-- Crea los ENUMs con los 7 estados completos. Si ya existen, los extiende.

CREATE TYPE IF NOT EXISTS cit_estado AS ENUM (
  'PENDIENTE_VALIDACION',
  'PROCESANDO_CRUCE',
  'ANOMALIA_DETECTADA',
  'ACTIVO',
  'VENCIDO',
  'RECHAZADO',
  'REVOCADO'
);

CREATE TYPE IF NOT EXISTS cit_bfa_estado AS ENUM (
  'NO_INICIADA',
  'PENDIENTE',
  'ACUNADO',
  'ERROR'
);
