-- RODAID — Modulo 4: CIT · Certificacion (Migracion e Integracion).
--
-- Roll-forward sobre la capa CIT ya aplicada (20260606170000_create_cit_identidad).
-- Esa migracion es inmutable: ya creo el rodado (`bicicletas`), el certificado
-- (`cits`), su audit trail (`cit_eventos`), el trigger de inmutabilidad
-- (`trg_cit_proteger_payload`) y los indices que el Marketplace y RODAID PAY
-- consultan. No se puede editar ni recrear; se corrige avanzando.
--
-- Esta consigna pide un ciclo de vida CIT de 7 estados, pero el ENUM aplicado
-- solo tiene 4 (PENDIENTE_VALIDACION, ACTIVO, VENCIDO, REVOCADO). Aqui se anaden
-- los 3 estados faltantes del cruce antifraude y del rechazo. Es la unica brecha
-- real entre lo solicitado y el esquema vivo; el resto de objetos pedidos ya
-- existen bajo los nombres canonicos que el codigo cruzado ya utiliza.
--
--   PROCESANDO_CRUCE    -- intake sellado; corriendo el cruce antifraude/anomalias
--   ANOMALIA_DETECTADA  -- el cruce marco una inconsistencia para revision
--   RECHAZADO           -- la certificacion fue desestimada (distinto de REVOCADO)
--
-- ALTER TYPE ... ADD VALUE es aditivo y no reescribe filas existentes: ningun
-- certificado vigente cambia de estado. IF NOT EXISTS lo deja idempotente ante
-- reaplicaciones. Se anexan al final del ENUM; el orden del enum no participa en
-- la logica de la aplicacion (los estados se comparan por igualdad).

-- La consigna exige la extension uuid-ossp habilitada. La capa CIT usa
-- gen_random_uuid (pgcrypto/core), pero se garantiza la disponibilidad de
-- uuid-ossp para cualquier consumidor que dependa de uuid_generate_v4().
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TYPE cit_estado ADD VALUE IF NOT EXISTS 'PROCESANDO_CRUCE';
ALTER TYPE cit_estado ADD VALUE IF NOT EXISTS 'ANOMALIA_DETECTADA';
ALTER TYPE cit_estado ADD VALUE IF NOT EXISTS 'RECHAZADO';
