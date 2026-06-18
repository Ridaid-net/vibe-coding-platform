-- ═══════════════════════════════════════════════════════════
-- RODAID · PostgreSQL Schema
-- Ley Provincial N° 9556 · Mendoza, Argentina
-- Migración: 001_init
-- ═══════════════════════════════════════════════════════════

-- ── Extensiones ───────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ─────────────────────────────────────────────────

CREATE TYPE rol_usuario AS ENUM (
  'CICLISTA',
  'INSPECTOR',
  'ALIADO',
  'ADMIN'
);

CREATE TYPE estado_cit AS ENUM (
  'PENDIENTE',    -- Dentro del período de 72 hs de validación
  'ACTIVO',       -- CIT emitido y NFT acuñado en BFA
  'RECHAZADO',    -- Coincide con denuncia activa — bloqueado
  'EXPIRADO',     -- Vencido (12 meses)
  'BLOQUEADO'     -- Denuncia de robo post-emisión
);

CREATE TYPE tipo_bicicleta AS ENUM (
  'MTB',
  'RUTA',
  'URBANA',
  'GRAVEL',
  'ELECTRICA',
  'BMX',
  'OTRO'
);

CREATE TYPE estado_publicacion AS ENUM (
  'ACTIVA',
  'VENDIDA',
  'PAUSADA',
  'ELIMINADA'
);

CREATE TYPE estado_pago AS ENUM (
  'PENDIENTE',
  'EN_ESCROW',
  'LIBERADO',
  'DEVUELTO',
  'FALLIDO'
);

CREATE TYPE tipo_notificacion AS ENUM (
  'CIT_APROBADO',
  'CIT_RECHAZADO',
  'CIT_POR_VENCER',
  'DENUNCIA_REGISTRADA',
  'BICI_RECUPERADA',
  'NUEVA_OFERTA',
  'VENTA_CONFIRMADA'
);

-- ══════════════════════════════════════════════════════════
-- TABLAS
-- ══════════════════════════════════════════════════════════

-- ── 1. Planes de suscripción ──────────────────────────────
CREATE TABLE planes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(50)  NOT NULL UNIQUE,  -- libre | estandar | premium
  precio_usd  NUMERIC(8,2) NOT NULL DEFAULT 0,
  cit_limite  INTEGER,                        -- NULL = ilimitado
  features    TEXT[]       NOT NULL DEFAULT '{}',
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  planes               IS 'Planes de suscripción RODAID';
COMMENT ON COLUMN planes.cit_limite    IS 'NULL significa CITs ilimitados (Plan Premium)';

-- ── 2. Usuarios ───────────────────────────────────────────
CREATE TABLE usuarios (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  email            VARCHAR(255) NOT NULL UNIQUE,
  password_hash    TEXT,                       -- NULL si autenticado solo via MxM
  nombre           VARCHAR(100) NOT NULL,
  apellido         VARCHAR(100) NOT NULL,
  dni              VARCHAR(20)  UNIQUE,
  cuil             VARCHAR(20)  UNIQUE,
  telefono         VARCHAR(30),
  rol              rol_usuario  NOT NULL DEFAULT 'CICLISTA',
  plan_id          UUID         REFERENCES planes(id) ON DELETE SET NULL,
  mxm_verificado   BOOLEAN      NOT NULL DEFAULT FALSE,
  mxm_nivel        SMALLINT     NOT NULL DEFAULT 0  CHECK (mxm_nivel BETWEEN 0 AND 2),
  mxm_token        TEXT,                       -- Token OAuth MxM cifrado con pgcrypto
  activo           BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  usuarios             IS 'Ciclistas, inspectores y administradores RODAID';
COMMENT ON COLUMN usuarios.mxm_nivel  IS '0=sin vincular, 1=básico, 2=verificado DNI';
COMMENT ON COLUMN usuarios.mxm_token  IS 'Cifrado con pgcrypto en reposo';

-- ── 3. Refresh tokens ─────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID         NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token       TEXT         NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 4. Talleres Aliados ───────────────────────────────────
CREATE TABLE talleres_aliados (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(200) NOT NULL,
  direccion   VARCHAR(300) NOT NULL,
  localidad   VARCHAR(100) NOT NULL,
  provincia   VARCHAR(100) NOT NULL DEFAULT 'Mendoza',
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  plan_aliado VARCHAR(20)  NOT NULL DEFAULT 'base'
                           CHECK (plan_aliado IN ('base','plus','fundador')),
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE talleres_aliados IS 'Bicicleterías adheridas como centros de validación oficial · Ley 9556';

-- ── 5. Inspectores ────────────────────────────────────────
CREATE TABLE inspectores (
  id               UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id       UUID     NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  taller_aliado_id UUID     NOT NULL REFERENCES talleres_aliados(id) ON DELETE RESTRICT,
  certificado      BOOLEAN  NOT NULL DEFAULT FALSE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE inspectores IS 'Mecánicos certificados habilitados para emitir CITs';

-- ── 6. Bicicletas ─────────────────────────────────────────
CREATE TABLE bicicletas (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  propietario_id   UUID           NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  numero_serie     VARCHAR(100)   NOT NULL UNIQUE,
  marca            VARCHAR(100)   NOT NULL,
  modelo           VARCHAR(200)   NOT NULL,
  anio             SMALLINT       NOT NULL CHECK (anio BETWEEN 1980 AND 2030),
  tipo             tipo_bicicleta NOT NULL,
  color            VARCHAR(80),
  fotos            TEXT[]         NOT NULL DEFAULT '{}',  -- URLs S3
  creado_en        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  bicicletas             IS 'Rodados registrados en la plataforma RODAID';
COMMENT ON COLUMN bicicletas.numero_serie IS 'Número de serie grabado en el cuadro — clave de verificación';

-- ── 7. CITs — Certificados de Identidad Técnica ───────────
CREATE TABLE cits (
  id                UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero_cit        VARCHAR(30) NOT NULL UNIQUE,  -- RCIT-YYYY-XXXXX
  bicicleta_id      UUID        NOT NULL REFERENCES bicicletas(id) ON DELETE RESTRICT,
  propietario_id    UUID        NOT NULL REFERENCES usuarios(id)   ON DELETE RESTRICT,
  inspector_id      UUID        NOT NULL REFERENCES inspectores(id) ON DELETE RESTRICT,
  taller_aliado_id  UUID        NOT NULL REFERENCES talleres_aliados(id) ON DELETE RESTRICT,
  estado            estado_cit  NOT NULL DEFAULT 'PENDIENTE',
  puntos            SMALLINT    NOT NULL CHECK (puntos BETWEEN 0 AND 20),
  punto_detalle     JSONB       NOT NULL DEFAULT '{}',
  -- Criptografía
  hash_sha256       VARCHAR(70) NOT NULL UNIQUE,  -- 0x + 64 hex chars
  bfa_tx_hash       VARCHAR(70),                  -- Hash tx en BFA
  nft_token_id      INTEGER,                      -- ID del NFT ERC-721
  firma_inspector   TEXT        NOT NULL,          -- PKCS#7 detached
  -- Declaración Jurada
  dj_firmada        BOOLEAN     NOT NULL DEFAULT FALSE,
  dj_firmada_en     TIMESTAMPTZ,
  -- Lifecycle
  fecha_emision     TIMESTAMPTZ,                  -- PENDIENTE → ACTIVO
  fecha_vencimiento TIMESTAMPTZ,                  -- fecha_emision + 12 meses
  km_auditados      INTEGER     NOT NULL DEFAULT 0 CHECK (km_auditados >= 0),
  -- Integraciones externas
  mxm_expediente    VARCHAR(100),                 -- ID expediente MxM
  mxm_pago_id       VARCHAR(100),                 -- ID pago tasa en MxM Pagos
  -- Fotos del protocolo de inspección (URLs S3)
  fotos             TEXT[]      NOT NULL DEFAULT '{}',
  notas             TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Constraint: solo puede haber 1 CIT activo o pendiente por bicicleta
  CONSTRAINT cit_activo_unico EXCLUDE USING btree (
    bicicleta_id WITH =
  ) WHERE (estado IN ('ACTIVO', 'PENDIENTE'))
);

COMMENT ON TABLE  cits            IS 'Certificados de Identidad Técnica · Ley 9556 · BFA · NFT ERC-721';
COMMENT ON COLUMN cits.hash_sha256 IS 'SHA-256 del payload canónico del CIT — anclado on-chain en BFA';
COMMENT ON COLUMN cits.nft_token_id IS 'Token ID del NFT ERC-721 en el smart contract RodaidCIT.sol';

-- ── 8. Cola de validación 72 hs ───────────────────────────
CREATE TABLE validacion_queue (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  cit_id              UUID         NOT NULL UNIQUE REFERENCES cits(id) ON DELETE CASCADE,
  serial_bicicleta    VARCHAR(100) NOT NULL,
  propietario_dni     VARCHAR(20)  NOT NULL,
  propietario_nombre  VARCHAR(200) NOT NULL,
  propietario_datos   JSONB        NOT NULL DEFAULT '{}',
  -- Ventana de validación
  iniciada_en         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  vence_en            TIMESTAMPTZ  NOT NULL,
  procesada_en        TIMESTAMPTZ,
  resultado           VARCHAR(20)  CHECK (resultado IN ('aprobado','rechazado')),
  -- Cruce con Ministerio de Seguridad Mendoza
  alerta_min_seg      BOOLEAN      NOT NULL DEFAULT FALSE,
  detalle_alerta      JSONB
);

COMMENT ON TABLE validacion_queue IS 'Cola de validación diferida 72 hs con el Ministerio de Seguridad Mendoza';

-- ── 9. Publicaciones del Marketplace ─────────────────────
CREATE TABLE publicaciones (
  id            UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id   UUID               NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  bicicleta_id  UUID               NOT NULL REFERENCES bicicletas(id) ON DELETE RESTRICT,
  titulo        VARCHAR(300)       NOT NULL,
  descripcion   TEXT,
  precio_ars    NUMERIC(12,2)      NOT NULL CHECK (precio_ars > 0),
  estado        estado_publicacion NOT NULL DEFAULT 'ACTIVA',
  vistas_count  INTEGER            NOT NULL DEFAULT 0,
  creado_en     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- ── 10. Transacciones RODAID PAY ──────────────────────────
CREATE TABLE transacciones (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  publicacion_id       UUID        NOT NULL REFERENCES publicaciones(id) ON DELETE RESTRICT,
  comprador_id         UUID        NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  vendedor_id          UUID        NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  monto_ars            NUMERIC(12,2) NOT NULL,
  comision_ars         NUMERIC(10,2) NOT NULL,  -- 2.5% RODAID
  estado_pago          estado_pago NOT NULL DEFAULT 'PENDIENTE',
  mp_preference_id     VARCHAR(200),
  mp_payment_id        VARCHAR(200),
  escrow_liberado_en   TIMESTAMPTZ,
  nft_transfer_tx_hash VARCHAR(70),
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT comprador_no_es_vendedor CHECK (comprador_id <> vendedor_id)
);

-- ── 11. Notificaciones ────────────────────────────────────
CREATE TABLE notificaciones (
  id           UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id   UUID             NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo         tipo_notificacion NOT NULL,
  titulo       VARCHAR(200)     NOT NULL,
  cuerpo       TEXT             NOT NULL,
  datos        JSONB,
  leida        BOOLEAN          NOT NULL DEFAULT FALSE,
  enviada_mxm  BOOLEAN          NOT NULL DEFAULT FALSE,
  creado_en    TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ── 12. Device tokens (Push FCM) ─────────────────────────
CREATE TABLE device_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE,
  plataforma  VARCHAR(20) NOT NULL CHECK (plataforma IN ('web','android','ios')),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════
-- ÍNDICES
-- ══════════════════════════════════════════════════════════

-- usuarios
CREATE INDEX idx_usuarios_email    ON usuarios(email);
CREATE INDEX idx_usuarios_dni      ON usuarios(dni)  WHERE dni IS NOT NULL;
CREATE INDEX idx_usuarios_cuil     ON usuarios(cuil) WHERE cuil IS NOT NULL;
CREATE INDEX idx_usuarios_plan     ON usuarios(plan_id);

-- bicicletas
CREATE INDEX idx_bicicletas_propietario  ON bicicletas(propietario_id);
CREATE INDEX idx_bicicletas_serie        ON bicicletas(numero_serie);
CREATE INDEX idx_bicicletas_marca_modelo ON bicicletas(marca, modelo);

-- cits
CREATE INDEX idx_cits_bicicleta     ON cits(bicicleta_id);
CREATE INDEX idx_cits_propietario   ON cits(propietario_id);
CREATE INDEX idx_cits_inspector     ON cits(inspector_id);
CREATE INDEX idx_cits_taller        ON cits(taller_aliado_id);
CREATE INDEX idx_cits_estado        ON cits(estado);
CREATE INDEX idx_cits_hash          ON cits(hash_sha256);
CREATE INDEX idx_cits_nft_token     ON cits(nft_token_id) WHERE nft_token_id IS NOT NULL;
CREATE INDEX idx_cits_vencimiento   ON cits(fecha_vencimiento) WHERE estado = 'ACTIVO';
-- JSONB GIN para búsqueda en puntoDetalle
CREATE INDEX idx_cits_punto_detalle ON cits USING gin(punto_detalle);

-- validacion_queue
CREATE INDEX idx_vq_cit       ON validacion_queue(cit_id);
CREATE INDEX idx_vq_vence     ON validacion_queue(vence_en) WHERE procesada_en IS NULL;
CREATE INDEX idx_vq_pendientes ON validacion_queue(iniciada_en) WHERE procesada_en IS NULL;

-- marketplace
CREATE INDEX idx_publi_vendedor  ON publicaciones(vendedor_id);
CREATE INDEX idx_publi_bici      ON publicaciones(bicicleta_id);
CREATE INDEX idx_publi_estado    ON publicaciones(estado);
CREATE INDEX idx_publi_precio    ON publicaciones(precio_ars) WHERE estado = 'ACTIVA';

-- transacciones
CREATE INDEX idx_trans_publicacion ON transacciones(publicacion_id);
CREATE INDEX idx_trans_comprador   ON transacciones(comprador_id);
CREATE INDEX idx_trans_vendedor    ON transacciones(vendedor_id);
CREATE INDEX idx_trans_estado      ON transacciones(estado_pago);

-- notificaciones
CREATE INDEX idx_notif_usuario ON notificaciones(usuario_id);
CREATE INDEX idx_notif_no_leidas ON notificaciones(usuario_id, leida) WHERE NOT leida;

-- refresh_tokens
CREATE INDEX idx_refresh_usuario ON refresh_tokens(usuario_id);
CREATE INDEX idx_refresh_expires ON refresh_tokens(expires_at);

-- inspectores
CREATE INDEX idx_inspectores_taller ON inspectores(taller_aliado_id);

-- ══════════════════════════════════════════════════════════
-- FUNCIONES Y TRIGGERS
-- ══════════════════════════════════════════════════════════

-- Actualización automática de updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bicicletas_updated_at
  BEFORE UPDATE ON bicicletas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cits_updated_at
  BEFORE UPDATE ON cits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_publicaciones_updated_at
  BEFORE UPDATE ON publicaciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_transacciones_updated_at
  BEFORE UPDATE ON transacciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-expirar CITs vencidos
CREATE OR REPLACE FUNCTION auto_expirar_cits()
RETURNS void AS $$
BEGIN
  UPDATE cits
  SET estado = 'EXPIRADO', actualizado_en = NOW()
  WHERE estado = 'ACTIVO'
    AND fecha_vencimiento < NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_expirar_cits IS 'Llamar periódicamente via pg_cron o cron job del backend';

-- Calcular automáticamente la fecha de vencimiento (emision + 12 meses)
CREATE OR REPLACE FUNCTION set_fecha_vencimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'ACTIVO' AND NEW.fecha_emision IS NOT NULL AND NEW.fecha_vencimiento IS NULL THEN
    NEW.fecha_vencimiento = NEW.fecha_emision + INTERVAL '12 months';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cit_vencimiento
  BEFORE INSERT OR UPDATE ON cits
  FOR EACH ROW EXECUTE FUNCTION set_fecha_vencimiento();

-- ══════════════════════════════════════════════════════════
-- VISTAS ÚTILES
-- ══════════════════════════════════════════════════════════

-- Vista: CIT completo con datos de bicicleta y propietario
CREATE OR REPLACE VIEW v_cits_completos AS
SELECT
  c.id,
  c.numero_cit,
  c.estado,
  c.puntos,
  c.hash_sha256,
  c.bfa_tx_hash,
  c.nft_token_id,
  c.fecha_emision,
  c.fecha_vencimiento,
  c.km_auditados,
  c.dj_firmada,
  c.mxm_expediente,
  b.numero_serie,
  b.marca,
  b.modelo,
  b.anio,
  b.tipo         AS tipo_bicicleta,
  u.nombre       AS propietario_nombre,
  u.apellido     AS propietario_apellido,
  u.dni          AS propietario_dni,
  u.email        AS propietario_email,
  i_usr.nombre   AS inspector_nombre,
  ta.nombre      AS taller_nombre,
  ta.localidad   AS taller_localidad,
  c.creado_en
FROM      cits c
JOIN      bicicletas     b    ON b.id = c.bicicleta_id
JOIN      usuarios       u    ON u.id = c.propietario_id
JOIN      inspectores    i    ON i.id = c.inspector_id
JOIN      usuarios       i_usr ON i_usr.id = i.usuario_id
JOIN      talleres_aliados ta ON ta.id = c.taller_aliado_id;

COMMENT ON VIEW v_cits_completos IS 'CIT con todos los datos de bicicleta, propietario, inspector y taller';

-- Vista: Marketplace activo con datos del CIT
CREATE OR REPLACE VIEW v_marketplace_activo AS
SELECT
  p.id            AS publicacion_id,
  p.titulo,
  p.descripcion,
  p.precio_ars,
  p.vistas_count,
  p.creado_en     AS publicado_en,
  b.numero_serie,
  b.marca,
  b.modelo,
  b.anio,
  b.tipo          AS tipo_bicicleta,
  b.fotos,
  c.numero_cit,
  c.estado        AS cit_estado,
  c.puntos        AS cit_puntos,
  c.km_auditados,
  c.nft_token_id,
  u.nombre        AS vendedor_nombre,
  u.id            AS vendedor_id
FROM      publicaciones p
JOIN      bicicletas    b ON b.id = p.bicicleta_id
JOIN      usuarios      u ON u.id = p.vendedor_id
LEFT JOIN cits          c ON c.bicicleta_id = b.id AND c.estado = 'ACTIVO'
WHERE     p.estado = 'ACTIVA';

COMMENT ON VIEW v_marketplace_activo IS 'Publicaciones activas del Marketplace con datos del CIT vinculado';

-- Vista: validaciones pendientes (para el worker de 72 hs)
CREATE OR REPLACE VIEW v_validaciones_pendientes AS
SELECT
  vq.id,
  vq.cit_id,
  vq.serial_bicicleta,
  vq.propietario_dni,
  vq.propietario_nombre,
  vq.propietario_datos,
  vq.iniciada_en,
  vq.vence_en,
  EXTRACT(EPOCH FROM (vq.vence_en - NOW())) / 3600 AS horas_restantes,
  c.hash_sha256,
  c.numero_cit
FROM  validacion_queue vq
JOIN  cits c ON c.id = vq.cit_id
WHERE vq.procesada_en IS NULL
ORDER BY vq.vence_en ASC;

COMMENT ON VIEW v_validaciones_pendientes IS 'CITs en período de validación de 72 hs ordenados por urgencia';
