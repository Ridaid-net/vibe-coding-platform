-- RODAID — Fase 4: inmutabilidad de inspecciones_fisicas (defensa en profundidad).
--
-- inspecciones_fisicas no tiene columna updated_at y ningun endpoint hace UPDATE
-- ni DELETE sobre ella hoy (cada inspeccion es un INSERT nuevo, nunca se edita
-- una fila existente) -- pero eso es una convencion de codigo, no una garantia.
-- Este trigger la vuelve append-only a nivel de base, mismo patron que
-- pagos_log_inmutable() (Hito 13): bloquea CUALQUIER UPDATE/DELETE, sin
-- excepciones (a diferencia de cit_proteger_payload, que deja pasar
-- updated_at -- aca no hay ningun campo legitimo que deba poder cambiar).
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

CREATE OR REPLACE FUNCTION inspeccion_fisica_inmutable()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inspecciones_fisicas es append-only: no se permite %', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_inspeccion_fisica_no_update ON inspecciones_fisicas;
CREATE TRIGGER trg_inspeccion_fisica_no_update
  BEFORE UPDATE OR DELETE ON inspecciones_fisicas
  FOR EACH ROW
  EXECUTE FUNCTION inspeccion_fisica_inmutable();

-- Defensa en profundidad: revoca el permiso a nivel de tabla (mismo patron que
-- pagos_log).
REVOKE UPDATE, DELETE, TRUNCATE ON inspecciones_fisicas FROM PUBLIC;
