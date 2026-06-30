-- RODAID — Modulo 4: extension uuid-ossp.
--
-- Los 3 estados adicionales del ciclo de vida del CIT (PROCESANDO_CRUCE,
-- ANOMALIA_DETECTADA, RECHAZADO) ya fueron incluidos en el ENUM inicial
-- en 20260618120000_create_cit_identidad.sql. Solo se mantiene aqui la
-- habilitacion de uuid-ossp para compatibilidad con consumidores externos.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
