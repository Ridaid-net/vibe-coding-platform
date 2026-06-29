-- RODAID — Servicio de Acunacion BFA & Motor de Notificaciones (integracion).
--
-- Migracion ADITIVA. Roll-forward sobre el esquema ya aplicado e inmutable; no
-- edita ni elimina ninguna migracion previa y no altera datos existentes.
--
-- Cubre dos frentes:
--   1. El estado de mint (acunacion del NFT en BFA) y la wallet de destino.
--   2. El Motor de Notificaciones (3 canales): tablas `notificaciones` y
--      `notif_preferencias`.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Estado de mint y wallet de destino sobre `cits`
-- ──────────────────────────────────────────────────────────────────────────────
--
-- La maquina de estados de mint pedida (mint_estado: NO_INICIADO / EN_PROCESO /
-- COMPLETADO / FALLIDO / REINTENTANDO) YA EXISTE en este esquema bajo el tipo
-- canonico `cit_bfa_estado` (creado en 20260606170000 y extendido en
-- 20260606220000), con la correspondencia exacta:
--
--     mint_estado          cit_bfa_estado (columna `cits.bfa_estado`)
--     ───────────          ──────────────
--     NO_INICIADO     ───▶ NO_INICIADA
--     EN_PROCESO      ───▶ PENDIENTE
--     COMPLETADO      ───▶ ACUNADO
--     REINTENTANDO    ───▶ ERROR        (transitorio; lo reintenta el worker)
--     FALLIDO         ───▶ FALLIDO      (fatal; bloqueo definitivo para auditoria)
--
-- Los contadores e info de error tambien existen ya: `bfa_intentos` (= mint_intentos)
-- y `bfa_ultimo_error` (= mint_ultimo_error). No se crean columnas duplicadas: hacerlo
-- introduciria una segunda fuente de verdad que ningun worker ni endpoint consume.
--
-- Lo unico genuinamente nuevo del mint es la WALLET de destino del NFT: si el
-- propietario aporta su wallet -> transferencia directa; si no -> Modelo Custodial
-- RODAID. Se persisten dos columnas aditivas y nullable.

ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_propietario_wallet VARCHAR(120);
ALTER TABLE cits ADD COLUMN IF NOT EXISTS bfa_modo_custodia VARCHAR(20);

COMMENT ON COLUMN cits.bfa_propietario_wallet IS
  'Wallet de destino del NFT acunado. En modo CUSTODIAL es la wallet custodial de RODAID.';
COMMENT ON COLUMN cits.bfa_modo_custodia IS
  'DIRECTO (el propietario aporto su wallet) o CUSTODIAL (Modelo Custodial RODAID).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Motor de Notificaciones
-- ──────────────────────────────────────────────────────────────────────────────

-- Catalogo de tipos de notificacion del sistema (1 por disparador de negocio).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notif_tipo') THEN
    CREATE TYPE notif_tipo AS ENUM (
      'CIT_APROBADO',
      'CIT_RECHAZADO',
      'CIT_POR_VENCER',
      'DENUNCIA_REGISTRADA',
      'BICI_RECUPERADA',
      'VENTA_CONFIRMADA',
      'COMPRA_COMPLETADA'
    );
  END IF;
END
$$;

-- Notificaciones del usuario. El canal IN_APP ES esta fila: siempre se guarda, de
-- forma transaccionalmente consistente con el evento de negocio que la dispara. El
-- estado de los canales externos (EMAIL/PUSH) queda asentado en `canales` para
-- diagnostico, sin condicionar la persistencia de la notificacion in-app.
CREATE TABLE IF NOT EXISTS notificaciones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   UUID NOT NULL,
  tipo         notif_tipo NOT NULL,
  titulo       TEXT NOT NULL,
  cuerpo       TEXT NOT NULL,
  cta_url      TEXT,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  canales      JSONB NOT NULL DEFAULT '{}'::jsonb,
  leida        BOOLEAN NOT NULL DEFAULT FALSE,
  leida_en     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Listado paginado del ciclista (mas recientes primero).
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario
  ON notificaciones (usuario_id, created_at DESC);

-- Filtro ?soloNoLeidas=true y badge de no leidas.
CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas
  ON notificaciones (usuario_id, created_at DESC)
  WHERE leida = FALSE;

-- Preferencias y datos de contacto del usuario para los canales externos. No hay
-- tabla de usuarios en el sistema (la identidad es el UUID del JWT): el email y los
-- tokens FCM se registran aqui a traves de los endpoints de preferencias / fcm-token.
CREATE TABLE IF NOT EXISTS notif_preferencias (
  usuario_id        UUID PRIMARY KEY,
  in_app_habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  email_habilitado  BOOLEAN NOT NULL DEFAULT TRUE,
  push_habilitado   BOOLEAN NOT NULL DEFAULT TRUE,
  email             TEXT,
  fcm_tokens        JSONB NOT NULL DEFAULT '[]'::jsonb,
  tipos_silenciados notif_tipo[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
