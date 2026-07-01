-- Agrega valor 'bloqueado' al enum cit_estado si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'bloqueado' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'cit_estado')
  ) THEN
    ALTER TYPE cit_estado ADD VALUE 'bloqueado';
  END IF;
END$$;
