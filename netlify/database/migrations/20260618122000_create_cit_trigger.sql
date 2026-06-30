-- RODAID — Modulo 4 (parte 3/3): trigger de inmutabilidad del CIT.
--
-- Requiere que 20260618121000_create_cit_tablas ya haya creado la tabla cits.

CREATE OR REPLACE FUNCTION cit_proteger_payload()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.huella_sha256 IS DISTINCT FROM OLD.huella_sha256
     OR NEW.firma_hmac IS DISTINCT FROM OLD.firma_hmac
     OR NEW.algoritmo IS DISTINCT FROM OLD.algoritmo
     OR NEW.snapshot_canonico IS DISTINCT FROM OLD.snapshot_canonico
     OR NEW.bicicleta_serial IS DISTINCT FROM OLD.bicicleta_serial
     OR NEW.inspeccion IS DISTINCT FROM OLD.inspeccion
     OR NEW.coordenadas_gps IS DISTINCT FROM OLD.coordenadas_gps
     OR NEW.fotos_hashes IS DISTINCT FROM OLD.fotos_hashes
     OR NEW.alerta_gps IS DISTINCT FROM OLD.alerta_gps
     OR NEW.bicicleta_id IS DISTINCT FROM OLD.bicicleta_id
     OR NEW.ciclista_id IS DISTINCT FROM OLD.ciclista_id
     OR NEW.aliado_id IS DISTINCT FROM OLD.aliado_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.sellado_en IS DISTINCT FROM OLD.sellado_en
     OR NEW.expira_en IS DISTINCT FROM OLD.expira_en
  THEN
    RAISE EXCEPTION
      'CIT %: los datos certificados son inmutables desde el intake.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cit_proteger_payload ON cits;

CREATE TRIGGER trg_cit_proteger_payload
  BEFORE UPDATE ON cits
  FOR EACH ROW
  EXECUTE FUNCTION cit_proteger_payload();
