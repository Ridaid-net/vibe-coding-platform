-- RODAID — Talleres Aliados de mejor desempeno publican sus propios servicios
-- en el footer (reemplaza la seccion "Servicios" 100% demo de app/servicios/page.tsx).
--
-- El umbral de CITs/dia vive en parametros_ranking_talleres (mismo patron que
-- parametros_pricing_cit) para no hardcodearlo. aliados suma columnas de
-- cache de desempeno, recalculadas por un worker diario (ver
-- netlify/functions/talleres-desempeno-worker.mts) — el footer se renderiza en
-- TODAS las paginas del sitio, no puede pagar una agregacion en vivo en cada
-- request. aliado_servicios_publicados es UNA fila por aliado (una sola
-- publicacion, no una lista), separada de aliado_servicios (vinculo bici<->
-- aliado del Hito 11, proposito distinto, sin relacion).
--
-- servicio usa CHECK, no ENUM: si se agrega un servicio nuevo a la lista fija
-- manana, es un solo ALTER en un solo deploy (no el problema de dos-deploys
-- de ALTER TYPE ... ADD VALUE ya documentado en CLAUDE.md).

CREATE TABLE IF NOT EXISTS parametros_ranking_talleres (
  clave VARCHAR(60) PRIMARY KEY,
  valor NUMERIC(12,4) NOT NULL,
  descripcion TEXT NOT NULL,
  actualizado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_parametros_ranking_talleres_updated_at ON parametros_ranking_talleres;
CREATE TRIGGER trg_parametros_ranking_talleres_updated_at
  BEFORE UPDATE ON parametros_ranking_talleres
  FOR EACH ROW EXECUTE FUNCTION usuarios_touch_updated_at();

INSERT INTO parametros_ranking_talleres (clave, valor, descripcion) VALUES
  ('umbral_cits_dia_promedio_30d', 6, 'Promedio minimo sostenido de CITs/dia (ventana 30 dias) para desbloquear la publicacion de servicios en el footer.')
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE aliados
  ADD COLUMN IF NOT EXISTS cits_promedio_30d NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS puede_publicar_servicios BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS desempeno_calculado_en TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS aliado_servicios_publicados (
  aliado_id UUID PRIMARY KEY REFERENCES aliados(id) ON DELETE CASCADE,
  servicio VARCHAR(60) NOT NULL CHECK (servicio IN (
    'tecnico_mantenimiento_lavado', 'tecnico_service_suspensiones_premium',
    'tecnico_tubelizacion_ruedas', 'tecnico_reparacion_purgado_frenos', 'tecnico_diagnostico_ebikes',
    'comercial_venta_bicicletas_nuevas', 'comercial_venta_repuestos_originales',
    'comercial_equipamiento_seguridad', 'comercial_indumentaria_tecnica',
    'ergonomico_bike_fitting', 'ergonomico_personalizacion_armado',
    'experiencia_alquiler_bicicletas', 'experiencia_bici_bar_cafeteria',
    'experiencia_envios_logistica', 'experiencia_logistica_eventos'
  )),
  precio_ars NUMERIC(10,2) NOT NULL CHECK (precio_ars > 0),
  logo_url TEXT NOT NULL,
  link_tienda TEXT,
  whatsapp_numero TEXT,
  publicado BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aliado_servicios_publicados_publicado ON aliado_servicios_publicados(publicado);
