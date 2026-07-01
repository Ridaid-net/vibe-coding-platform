-- Agrega todos los valores posibles al enum cit_estado
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'activo' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'cit_estado')) THEN
    ALTER TYPE cit_estado ADD VALUE 'activo';
  END IF;
END$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pendiente' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'cit_estado')) THEN
    ALTER TYPE cit_estado ADD VALUE 'pendiente';
  END IF;
END$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rechazado' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'cit_estado')) THEN
    ALTER TYPE cit_estado ADD VALUE 'rechazado';
  END IF;
END$$;
