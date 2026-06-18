--
-- PostgreSQL database dump
--

\restrict tamwTmmUzf9JwJWfmP8p06hxJigajWmORCtvpeJoFfRgQrUya4FeP3vqWwKmqST

-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: estado_cit; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.estado_cit AS ENUM (
    'PENDIENTE',
    'ACTIVO',
    'RECHAZADO',
    'EXPIRADO',
    'BLOQUEADO'
);


ALTER TYPE public.estado_cit OWNER TO postgres;

--
-- Name: estado_pago; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.estado_pago AS ENUM (
    'PENDIENTE',
    'EN_ESCROW',
    'LIBERADO',
    'DEVUELTO',
    'FALLIDO'
);


ALTER TYPE public.estado_pago OWNER TO postgres;

--
-- Name: estado_publicacion; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.estado_publicacion AS ENUM (
    'ACTIVA',
    'VENDIDA',
    'PAUSADA',
    'ELIMINADA'
);


ALTER TYPE public.estado_publicacion OWNER TO postgres;

--
-- Name: rol_usuario; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.rol_usuario AS ENUM (
    'CICLISTA',
    'INSPECTOR',
    'ALIADO',
    'ADMIN'
);


ALTER TYPE public.rol_usuario OWNER TO postgres;

--
-- Name: tipo_bicicleta; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.tipo_bicicleta AS ENUM (
    'MTB',
    'RUTA',
    'URBANA',
    'GRAVEL',
    'ELECTRICA',
    'BMX',
    'OTRO'
);


ALTER TYPE public.tipo_bicicleta OWNER TO postgres;

--
-- Name: tipo_notificacion; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.tipo_notificacion AS ENUM (
    'CIT_APROBADO',
    'CIT_RECHAZADO',
    'CIT_POR_VENCER',
    'DENUNCIA_REGISTRADA',
    'BICI_RECUPERADA',
    'NUEVA_OFERTA',
    'VENTA_CONFIRMADA'
);


ALTER TYPE public.tipo_notificacion OWNER TO postgres;

--
-- Name: auto_expirar_cits(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.auto_expirar_cits() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE cits
  SET estado = 'EXPIRADO', actualizado_en = NOW()
  WHERE estado = 'ACTIVO'
    AND fecha_vencimiento < NOW();
END;
$$;


ALTER FUNCTION public.auto_expirar_cits() OWNER TO postgres;

--
-- Name: FUNCTION auto_expirar_cits(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.auto_expirar_cits() IS 'Llamar periódicamente via pg_cron o cron job del backend';


--
-- Name: set_fecha_vencimiento(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_fecha_vencimiento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.estado = 'ACTIVO' AND NEW.fecha_emision IS NOT NULL AND NEW.fecha_vencimiento IS NULL THEN
    NEW.fecha_vencimiento = NEW.fecha_emision + INTERVAL '12 months';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_fecha_vencimiento() OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bicicletas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bicicletas (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    propietario_id uuid NOT NULL,
    numero_serie character varying(100) NOT NULL,
    marca character varying(100) NOT NULL,
    modelo character varying(200) NOT NULL,
    anio smallint NOT NULL,
    tipo public.tipo_bicicleta NOT NULL,
    color character varying(80),
    fotos text[] DEFAULT '{}'::text[] NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bicicletas_anio_check CHECK (((anio >= 1980) AND (anio <= 2030)))
);


ALTER TABLE public.bicicletas OWNER TO postgres;

--
-- Name: TABLE bicicletas; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.bicicletas IS 'Rodados registrados en la plataforma RODAID';


--
-- Name: COLUMN bicicletas.numero_serie; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bicicletas.numero_serie IS 'Número de serie grabado en el cuadro — clave de verificación';


--
-- Name: cits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cits (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    numero_cit character varying(30) NOT NULL,
    bicicleta_id uuid NOT NULL,
    propietario_id uuid NOT NULL,
    inspector_id uuid NOT NULL,
    taller_aliado_id uuid NOT NULL,
    estado public.estado_cit DEFAULT 'PENDIENTE'::public.estado_cit NOT NULL,
    puntos smallint NOT NULL,
    punto_detalle jsonb DEFAULT '{}'::jsonb NOT NULL,
    hash_sha256 character varying(70) NOT NULL,
    bfa_tx_hash character varying(70),
    nft_token_id integer,
    firma_inspector text NOT NULL,
    dj_firmada boolean DEFAULT false NOT NULL,
    dj_firmada_en timestamp with time zone,
    fecha_emision timestamp with time zone,
    fecha_vencimiento timestamp with time zone,
    km_auditados integer DEFAULT 0 NOT NULL,
    mxm_expediente character varying(100),
    mxm_pago_id character varying(100),
    fotos text[] DEFAULT '{}'::text[] NOT NULL,
    notas text,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cits_km_auditados_check CHECK ((km_auditados >= 0)),
    CONSTRAINT cits_puntos_check CHECK (((puntos >= 0) AND (puntos <= 20)))
);


ALTER TABLE public.cits OWNER TO postgres;

--
-- Name: TABLE cits; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.cits IS 'Certificados de Identidad Técnica · Ley 9556 · BFA · NFT ERC-721';


--
-- Name: COLUMN cits.hash_sha256; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.cits.hash_sha256 IS 'SHA-256 del payload canónico del CIT — anclado on-chain en BFA';


--
-- Name: COLUMN cits.nft_token_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.cits.nft_token_id IS 'Token ID del NFT ERC-721 en el smart contract RodaidCIT.sol';


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.device_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    usuario_id uuid NOT NULL,
    token text NOT NULL,
    plataforma character varying(20) NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_tokens_plataforma_check CHECK (((plataforma)::text = ANY ((ARRAY['web'::character varying, 'android'::character varying, 'ios'::character varying])::text[])))
);


ALTER TABLE public.device_tokens OWNER TO postgres;

--
-- Name: inspectores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inspectores (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    usuario_id uuid NOT NULL,
    taller_aliado_id uuid NOT NULL,
    certificado boolean DEFAULT false NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.inspectores OWNER TO postgres;

--
-- Name: TABLE inspectores; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.inspectores IS 'Mecánicos certificados habilitados para emitir CITs';


--
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notificaciones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    usuario_id uuid NOT NULL,
    tipo public.tipo_notificacion NOT NULL,
    titulo character varying(200) NOT NULL,
    cuerpo text NOT NULL,
    datos jsonb,
    leida boolean DEFAULT false NOT NULL,
    enviada_mxm boolean DEFAULT false NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notificaciones OWNER TO postgres;

--
-- Name: planes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.planes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    nombre character varying(50) NOT NULL,
    precio_usd numeric(8,2) DEFAULT 0 NOT NULL,
    cit_limite integer,
    features text[] DEFAULT '{}'::text[] NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.planes OWNER TO postgres;

--
-- Name: TABLE planes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.planes IS 'Planes de suscripción RODAID';


--
-- Name: COLUMN planes.cit_limite; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.planes.cit_limite IS 'NULL significa CITs ilimitados (Plan Premium)';


--
-- Name: publicaciones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.publicaciones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    vendedor_id uuid NOT NULL,
    bicicleta_id uuid NOT NULL,
    titulo character varying(300) NOT NULL,
    descripcion text,
    precio_ars numeric(12,2) NOT NULL,
    estado public.estado_publicacion DEFAULT 'ACTIVA'::public.estado_publicacion NOT NULL,
    vistas_count integer DEFAULT 0 NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT publicaciones_precio_ars_check CHECK ((precio_ars > (0)::numeric))
);


ALTER TABLE public.publicaciones OWNER TO postgres;

--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    usuario_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.refresh_tokens OWNER TO postgres;

--
-- Name: talleres_aliados; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.talleres_aliados (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    nombre character varying(200) NOT NULL,
    direccion character varying(300) NOT NULL,
    localidad character varying(100) NOT NULL,
    provincia character varying(100) DEFAULT 'Mendoza'::character varying NOT NULL,
    lat double precision,
    lng double precision,
    plan_aliado character varying(20) DEFAULT 'base'::character varying NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talleres_aliados_plan_aliado_check CHECK (((plan_aliado)::text = ANY ((ARRAY['base'::character varying, 'plus'::character varying, 'fundador'::character varying])::text[])))
);


ALTER TABLE public.talleres_aliados OWNER TO postgres;

--
-- Name: TABLE talleres_aliados; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.talleres_aliados IS 'Bicicleterías adheridas como centros de validación oficial · Ley 9556';


--
-- Name: transacciones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transacciones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    publicacion_id uuid NOT NULL,
    comprador_id uuid NOT NULL,
    vendedor_id uuid NOT NULL,
    monto_ars numeric(12,2) NOT NULL,
    comision_ars numeric(10,2) NOT NULL,
    estado_pago public.estado_pago DEFAULT 'PENDIENTE'::public.estado_pago NOT NULL,
    mp_preference_id character varying(200),
    mp_payment_id character varying(200),
    escrow_liberado_en timestamp with time zone,
    nft_transfer_tx_hash character varying(70),
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comprador_no_es_vendedor CHECK ((comprador_id <> vendedor_id))
);


ALTER TABLE public.transacciones OWNER TO postgres;

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text,
    nombre character varying(100) NOT NULL,
    apellido character varying(100) NOT NULL,
    dni character varying(20),
    cuil character varying(20),
    telefono character varying(30),
    rol public.rol_usuario DEFAULT 'CICLISTA'::public.rol_usuario NOT NULL,
    plan_id uuid,
    mxm_verificado boolean DEFAULT false NOT NULL,
    mxm_nivel smallint DEFAULT 0 NOT NULL,
    mxm_token text,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usuarios_mxm_nivel_check CHECK (((mxm_nivel >= 0) AND (mxm_nivel <= 2)))
);


ALTER TABLE public.usuarios OWNER TO postgres;

--
-- Name: TABLE usuarios; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.usuarios IS 'Ciclistas, inspectores y administradores RODAID';


--
-- Name: COLUMN usuarios.mxm_nivel; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.usuarios.mxm_nivel IS '0=sin vincular, 1=básico, 2=verificado DNI';


--
-- Name: COLUMN usuarios.mxm_token; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.usuarios.mxm_token IS 'Cifrado con pgcrypto en reposo';


--
-- Name: v_cits_completos; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_cits_completos AS
 SELECT c.id,
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
    b.tipo AS tipo_bicicleta,
    u.nombre AS propietario_nombre,
    u.apellido AS propietario_apellido,
    u.dni AS propietario_dni,
    u.email AS propietario_email,
    i_usr.nombre AS inspector_nombre,
    ta.nombre AS taller_nombre,
    ta.localidad AS taller_localidad,
    c.creado_en
   FROM (((((public.cits c
     JOIN public.bicicletas b ON ((b.id = c.bicicleta_id)))
     JOIN public.usuarios u ON ((u.id = c.propietario_id)))
     JOIN public.inspectores i ON ((i.id = c.inspector_id)))
     JOIN public.usuarios i_usr ON ((i_usr.id = i.usuario_id)))
     JOIN public.talleres_aliados ta ON ((ta.id = c.taller_aliado_id)));


ALTER VIEW public.v_cits_completos OWNER TO postgres;

--
-- Name: VIEW v_cits_completos; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.v_cits_completos IS 'CIT con todos los datos de bicicleta, propietario, inspector y taller';


--
-- Name: v_marketplace_activo; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_marketplace_activo AS
 SELECT p.id AS publicacion_id,
    p.titulo,
    p.descripcion,
    p.precio_ars,
    p.vistas_count,
    p.creado_en AS publicado_en,
    b.numero_serie,
    b.marca,
    b.modelo,
    b.anio,
    b.tipo AS tipo_bicicleta,
    b.fotos,
    c.numero_cit,
    c.estado AS cit_estado,
    c.puntos AS cit_puntos,
    c.km_auditados,
    c.nft_token_id,
    u.nombre AS vendedor_nombre,
    u.id AS vendedor_id
   FROM (((public.publicaciones p
     JOIN public.bicicletas b ON ((b.id = p.bicicleta_id)))
     JOIN public.usuarios u ON ((u.id = p.vendedor_id)))
     LEFT JOIN public.cits c ON (((c.bicicleta_id = b.id) AND (c.estado = 'ACTIVO'::public.estado_cit))))
  WHERE (p.estado = 'ACTIVA'::public.estado_publicacion);


ALTER VIEW public.v_marketplace_activo OWNER TO postgres;

--
-- Name: VIEW v_marketplace_activo; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.v_marketplace_activo IS 'Publicaciones activas del Marketplace con datos del CIT vinculado';


--
-- Name: validacion_queue; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.validacion_queue (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cit_id uuid NOT NULL,
    serial_bicicleta character varying(100) NOT NULL,
    propietario_dni character varying(20) NOT NULL,
    propietario_nombre character varying(200) NOT NULL,
    propietario_datos jsonb DEFAULT '{}'::jsonb NOT NULL,
    iniciada_en timestamp with time zone DEFAULT now() NOT NULL,
    vence_en timestamp with time zone NOT NULL,
    procesada_en timestamp with time zone,
    resultado character varying(20),
    alerta_min_seg boolean DEFAULT false NOT NULL,
    detalle_alerta jsonb,
    CONSTRAINT validacion_queue_resultado_check CHECK (((resultado)::text = ANY ((ARRAY['aprobado'::character varying, 'rechazado'::character varying])::text[])))
);


ALTER TABLE public.validacion_queue OWNER TO postgres;

--
-- Name: TABLE validacion_queue; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.validacion_queue IS 'Cola de validación diferida 72 hs con el Ministerio de Seguridad Mendoza';


--
-- Name: v_validaciones_pendientes; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_validaciones_pendientes AS
 SELECT vq.id,
    vq.cit_id,
    vq.serial_bicicleta,
    vq.propietario_dni,
    vq.propietario_nombre,
    vq.propietario_datos,
    vq.iniciada_en,
    vq.vence_en,
    (EXTRACT(epoch FROM (vq.vence_en - now())) / (3600)::numeric) AS horas_restantes,
    c.hash_sha256,
    c.numero_cit
   FROM (public.validacion_queue vq
     JOIN public.cits c ON ((c.id = vq.cit_id)))
  WHERE (vq.procesada_en IS NULL)
  ORDER BY vq.vence_en;


ALTER VIEW public.v_validaciones_pendientes OWNER TO postgres;

--
-- Name: VIEW v_validaciones_pendientes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.v_validaciones_pendientes IS 'CITs en período de validación de 72 hs ordenados por urgencia';


--
-- Name: bicicletas bicicletas_numero_serie_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bicicletas
    ADD CONSTRAINT bicicletas_numero_serie_key UNIQUE (numero_serie);


--
-- Name: bicicletas bicicletas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bicicletas
    ADD CONSTRAINT bicicletas_pkey PRIMARY KEY (id);


--
-- Name: cits cit_activo_unico; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cit_activo_unico EXCLUDE USING btree (bicicleta_id WITH =) WHERE ((estado = ANY (ARRAY['ACTIVO'::public.estado_cit, 'PENDIENTE'::public.estado_cit])));


--
-- Name: cits cits_hash_sha256_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cits_hash_sha256_key UNIQUE (hash_sha256);


--
-- Name: cits cits_numero_cit_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cits_numero_cit_key UNIQUE (numero_cit);


--
-- Name: cits cits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cits_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_token_key UNIQUE (token);


--
-- Name: inspectores inspectores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspectores
    ADD CONSTRAINT inspectores_pkey PRIMARY KEY (id);


--
-- Name: inspectores inspectores_usuario_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspectores
    ADD CONSTRAINT inspectores_usuario_id_key UNIQUE (usuario_id);


--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- Name: planes planes_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planes
    ADD CONSTRAINT planes_nombre_key UNIQUE (nombre);


--
-- Name: planes planes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planes
    ADD CONSTRAINT planes_pkey PRIMARY KEY (id);


--
-- Name: publicaciones publicaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.publicaciones
    ADD CONSTRAINT publicaciones_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);


--
-- Name: talleres_aliados talleres_aliados_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.talleres_aliados
    ADD CONSTRAINT talleres_aliados_pkey PRIMARY KEY (id);


--
-- Name: transacciones transacciones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transacciones
    ADD CONSTRAINT transacciones_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_cuil_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_cuil_key UNIQUE (cuil);


--
-- Name: usuarios usuarios_dni_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_dni_key UNIQUE (dni);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: validacion_queue validacion_queue_cit_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validacion_queue
    ADD CONSTRAINT validacion_queue_cit_id_key UNIQUE (cit_id);


--
-- Name: validacion_queue validacion_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validacion_queue
    ADD CONSTRAINT validacion_queue_pkey PRIMARY KEY (id);


--
-- Name: idx_bicicletas_marca_modelo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bicicletas_marca_modelo ON public.bicicletas USING btree (marca, modelo);


--
-- Name: idx_bicicletas_propietario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bicicletas_propietario ON public.bicicletas USING btree (propietario_id);


--
-- Name: idx_bicicletas_serie; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bicicletas_serie ON public.bicicletas USING btree (numero_serie);


--
-- Name: idx_cits_bicicleta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_bicicleta ON public.cits USING btree (bicicleta_id);


--
-- Name: idx_cits_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_estado ON public.cits USING btree (estado);


--
-- Name: idx_cits_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_hash ON public.cits USING btree (hash_sha256);


--
-- Name: idx_cits_inspector; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_inspector ON public.cits USING btree (inspector_id);


--
-- Name: idx_cits_nft_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_nft_token ON public.cits USING btree (nft_token_id) WHERE (nft_token_id IS NOT NULL);


--
-- Name: idx_cits_propietario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_propietario ON public.cits USING btree (propietario_id);


--
-- Name: idx_cits_punto_detalle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_punto_detalle ON public.cits USING gin (punto_detalle);


--
-- Name: idx_cits_taller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_taller ON public.cits USING btree (taller_aliado_id);


--
-- Name: idx_cits_vencimiento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cits_vencimiento ON public.cits USING btree (fecha_vencimiento) WHERE (estado = 'ACTIVO'::public.estado_cit);


--
-- Name: idx_inspectores_taller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inspectores_taller ON public.inspectores USING btree (taller_aliado_id);


--
-- Name: idx_notif_no_leidas; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notif_no_leidas ON public.notificaciones USING btree (usuario_id, leida) WHERE (NOT leida);


--
-- Name: idx_notif_usuario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notif_usuario ON public.notificaciones USING btree (usuario_id);


--
-- Name: idx_publi_bici; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_publi_bici ON public.publicaciones USING btree (bicicleta_id);


--
-- Name: idx_publi_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_publi_estado ON public.publicaciones USING btree (estado);


--
-- Name: idx_publi_precio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_publi_precio ON public.publicaciones USING btree (precio_ars) WHERE (estado = 'ACTIVA'::public.estado_publicacion);


--
-- Name: idx_publi_vendedor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_publi_vendedor ON public.publicaciones USING btree (vendedor_id);


--
-- Name: idx_refresh_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refresh_expires ON public.refresh_tokens USING btree (expires_at);


--
-- Name: idx_refresh_usuario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refresh_usuario ON public.refresh_tokens USING btree (usuario_id);


--
-- Name: idx_trans_comprador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trans_comprador ON public.transacciones USING btree (comprador_id);


--
-- Name: idx_trans_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trans_estado ON public.transacciones USING btree (estado_pago);


--
-- Name: idx_trans_publicacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trans_publicacion ON public.transacciones USING btree (publicacion_id);


--
-- Name: idx_trans_vendedor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trans_vendedor ON public.transacciones USING btree (vendedor_id);


--
-- Name: idx_usuarios_cuil; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_cuil ON public.usuarios USING btree (cuil) WHERE (cuil IS NOT NULL);


--
-- Name: idx_usuarios_dni; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_dni ON public.usuarios USING btree (dni) WHERE (dni IS NOT NULL);


--
-- Name: idx_usuarios_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_email ON public.usuarios USING btree (email);


--
-- Name: idx_usuarios_plan; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_plan ON public.usuarios USING btree (plan_id);


--
-- Name: idx_vq_cit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vq_cit ON public.validacion_queue USING btree (cit_id);


--
-- Name: idx_vq_pendientes; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vq_pendientes ON public.validacion_queue USING btree (iniciada_en) WHERE (procesada_en IS NULL);


--
-- Name: idx_vq_vence; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vq_vence ON public.validacion_queue USING btree (vence_en) WHERE (procesada_en IS NULL);


--
-- Name: bicicletas trg_bicicletas_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_bicicletas_updated_at BEFORE UPDATE ON public.bicicletas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cits trg_cit_vencimiento; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_cit_vencimiento BEFORE INSERT OR UPDATE ON public.cits FOR EACH ROW EXECUTE FUNCTION public.set_fecha_vencimiento();


--
-- Name: cits trg_cits_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_cits_updated_at BEFORE UPDATE ON public.cits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: publicaciones trg_publicaciones_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_publicaciones_updated_at BEFORE UPDATE ON public.publicaciones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transacciones trg_transacciones_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_transacciones_updated_at BEFORE UPDATE ON public.transacciones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: usuarios trg_usuarios_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: bicicletas bicicletas_propietario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bicicletas
    ADD CONSTRAINT bicicletas_propietario_id_fkey FOREIGN KEY (propietario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: cits cits_bicicleta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cits_bicicleta_id_fkey FOREIGN KEY (bicicleta_id) REFERENCES public.bicicletas(id) ON DELETE RESTRICT;


--
-- Name: cits cits_inspector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cits_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES public.inspectores(id) ON DELETE RESTRICT;


--
-- Name: cits cits_propietario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cits_propietario_id_fkey FOREIGN KEY (propietario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: cits cits_taller_aliado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cits
    ADD CONSTRAINT cits_taller_aliado_id_fkey FOREIGN KEY (taller_aliado_id) REFERENCES public.talleres_aliados(id) ON DELETE RESTRICT;


--
-- Name: device_tokens device_tokens_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: inspectores inspectores_taller_aliado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspectores
    ADD CONSTRAINT inspectores_taller_aliado_id_fkey FOREIGN KEY (taller_aliado_id) REFERENCES public.talleres_aliados(id) ON DELETE RESTRICT;


--
-- Name: inspectores inspectores_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspectores
    ADD CONSTRAINT inspectores_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: notificaciones notificaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: publicaciones publicaciones_bicicleta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.publicaciones
    ADD CONSTRAINT publicaciones_bicicleta_id_fkey FOREIGN KEY (bicicleta_id) REFERENCES public.bicicletas(id) ON DELETE RESTRICT;


--
-- Name: publicaciones publicaciones_vendedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.publicaciones
    ADD CONSTRAINT publicaciones_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: refresh_tokens refresh_tokens_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: transacciones transacciones_comprador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transacciones
    ADD CONSTRAINT transacciones_comprador_id_fkey FOREIGN KEY (comprador_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: transacciones transacciones_publicacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transacciones
    ADD CONSTRAINT transacciones_publicacion_id_fkey FOREIGN KEY (publicacion_id) REFERENCES public.publicaciones(id) ON DELETE RESTRICT;


--
-- Name: transacciones transacciones_vendedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transacciones
    ADD CONSTRAINT transacciones_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: usuarios usuarios_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE SET NULL;


--
-- Name: validacion_queue validacion_queue_cit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validacion_queue
    ADD CONSTRAINT validacion_queue_cit_id_fkey FOREIGN KEY (cit_id) REFERENCES public.cits(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict tamwTmmUzf9JwJWfmP8p06hxJigajWmORCtvpeJoFfRgQrUya4FeP3vqWwKmqST

