-- RODAID — Modulo 4 (parte 1/3): tipos ENUM del CIT.
-- Incluye los 7 estados completos del ciclo de vida del CIT.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'PENDIENTE_VALIDACION',
      'PROCESANDO_CRUCE',
      'ANOMALIA_DETECTADA',
      'ACTIVO',
      'VENCIDO',
      'RECHAZADO',
      'REVOCADO'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_bfa_estado') THEN
    CREATE TYPE cit_bfa_estado AS ENUM (
      'NO_INICIADA',
      'PENDIENTE',
      'ACUNADO',
      'ERROR'
    );
  END IF;
END
$$;
