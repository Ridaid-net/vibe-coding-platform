-- RODAID — Log de auditoria del mecanismo de indexacion automatica de
-- precios (dolar BNA). Append-only (nunca UPDATE/DELETE), mismo principio
-- que pagos_log y admin_bitacora. Registra TODOS los ciclos de evaluacion
-- del worker, no solo los que efectivamente ajustaron un precio -- asi
-- queda rastro explicito de si el mecanismo corrio y decidio no actuar,
-- vs. si nunca corrio. Es la unica red de seguridad de un mecanismo que
-- mueve precios reales sin aprobacion previa: tiene que ser imposible de
-- alterar despues del hecho.

CREATE TABLE IF NOT EXISTS parametros_pricing_ajustes_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecutado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cotizacion_anterior NUMERIC(12,4) NOT NULL,
  cotizacion_nueva NUMERIC(12,4) NOT NULL,
  variacion_pct NUMERIC(8,6) NOT NULL,
  umbral_pct NUMERIC(8,6) NOT NULL,
  accion VARCHAR(20) NOT NULL CHECK (accion IN (
    'AJUSTADO', 'SIN_CAMBIOS', 'ABORTADO_ANOMALIA', 'ABORTADO_FUENTE_CAIDA'
  )),
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pricing_ajustes_log_ejecutado_en
  ON parametros_pricing_ajustes_log (ejecutado_en DESC);
