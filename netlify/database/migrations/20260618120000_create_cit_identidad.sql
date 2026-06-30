-- RODAID — Modulo 4 (parte 1/3): tipos ENUM del CIT.
--
-- Aislado de las tablas que lo usan para descartar problemas de parsing
-- de bloques DO $$ ... END $$; combinados con CREATE TABLE en un mismo
-- archivo de migracion.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cit_estado') THEN
    CREATE TYPE cit_estado AS ENUM (
      'PENDIENTE_VALIDACION',
      'ACTIVO',
      'VENCIDO',
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
