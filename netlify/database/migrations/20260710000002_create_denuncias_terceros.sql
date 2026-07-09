-- RODAID — Sistema de tarifas de denuncia de robo (caso 3: tercero denuncia
-- una bici ajena que sospecha robada). Retencion de $30.000 ARS (leido en
-- vivo de cit_completo_precio_publicado_ars, NO hardcodeado -- ver
-- denuncia-tercero.service.ts), reembolsable segun resolucion.
--
-- IMPORTANTE: este flujo esta DESHABILITADO DELIBERADAMENTE en produccion
-- (ver TODO fechado en denuncia-tercero.service.ts) -- la Policia de Mendoza
-- opera con radiocomunicacion TETRA, no hay canal real todavia para resolver
-- ESPERANDO_POLICIA de forma automatica ni semi-automatica. Esta migracion
-- crea el schema completo de todas formas: la maquina de estados y el worker
-- quedan listos y probables end-to-end (via el endpoint admin de simulacion
-- de la policia, y el endpoint real de confirmacion del propietario) para el
-- dia que ese canal exista -- no hay ningun ALTER TYPE ADD VALUE pendiente
-- para ese momento, todos los valores del enum ya estan aca.

CREATE TYPE denuncia_tercero_estado AS ENUM (
  'PAGO_PENDIENTE',
  'VERIFICANDO_AUTOMATICO',
  'ESPERANDO_POLICIA',
  'ESPERANDO_PROPIETARIO',
  'RESUELTO_REEMBOLSADO',
  'RESUELTO_PERDIDO'
);

CREATE TABLE denuncias_terceros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: un tercero puede denunciar una serie que no esta registrada en
  -- RODAID todavia -- en ese caso no hay a quien consultarle en
  -- ESPERANDO_PROPIETARIO, se salta directo al reembolso por defecto.
  bicicleta_id UUID REFERENCES bicicletas (id) ON DELETE SET NULL,
  numero_serie_normalizado VARCHAR(120) NOT NULL,
  denunciante_id UUID NOT NULL REFERENCES usuarios (id),
  estado denuncia_tercero_estado NOT NULL DEFAULT 'PAGO_PENDIENTE',

  -- Congelado en el momento de crear la denuncia (leido de
  -- cit_completo_precio_publicado_ars) -- no se recalcula si el pricing de
  -- CIT Completo cambia despues.
  monto_ars NUMERIC(12,2) NOT NULL CHECK (monto_ars > 0),
  gateway VARCHAR(20) NOT NULL DEFAULT 'mercadopago',
  preference_id TEXT,
  payment_id TEXT,
  pagado_en TIMESTAMPTZ,

  -- Snapshot del resultado del mock de cross-reference en el momento del
  -- chequeo automatico (auditoria -- que vio el sistema en ese instante).
  cross_reference_resultado JSONB,

  policia_consultada_en TIMESTAMPTZ,
  policia_vence_en TIMESTAMPTZ,
  policia_confirmo BOOLEAN, -- NULL = sin respuesta (silencio), true = robada, false = denuncia falsa

  propietario_consultado_en TIMESTAMPTZ,
  propietario_vence_en TIMESTAMPTZ,
  propietario_confirmo BOOLEAN, -- misma semantica que policia_confirmo

  resolucion VARCHAR(20) CHECK (resolucion IN ('REEMBOLSADO', 'PERDIDO')),
  resolucion_motivo TEXT,
  resuelto_en TIMESTAMPTZ,

  refund_id TEXT, -- id del reembolso de MercadoPago si resolucion = 'REEMBOLSADO'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evita que dos terceros denuncien la MISMA serie en simultaneo mientras una
-- denuncia sigue viva (no resuelta) -- por numero de serie, no por
-- bicicleta_id, para cubrir tambien series no registradas en RODAID.
CREATE UNIQUE INDEX idx_denuncias_terceros_activa_unica
  ON denuncias_terceros (numero_serie_normalizado)
  WHERE estado NOT IN ('RESUELTO_REEMBOLSADO', 'RESUELTO_PERDIDO');

CREATE INDEX idx_denuncias_terceros_bicicleta
  ON denuncias_terceros (bicicleta_id)
  WHERE bicicleta_id IS NOT NULL;

-- Indices parciales para el barrido del worker (mismo patron que
-- escrow_transacciones.reserva_vence_en).
CREATE INDEX idx_denuncias_terceros_policia_vence
  ON denuncias_terceros (policia_vence_en)
  WHERE estado = 'ESPERANDO_POLICIA';

CREATE INDEX idx_denuncias_terceros_propietario_vence
  ON denuncias_terceros (propietario_vence_en)
  WHERE estado = 'ESPERANDO_PROPIETARIO';

CREATE INDEX idx_denuncias_terceros_denunciante
  ON denuncias_terceros (denunciante_id);
