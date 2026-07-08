-- RODAID — Fase 0: Parametros de Pricing CIT (Express / Completo).
--
-- Hasta esta migracion, los valores de precios y comisiones vivian hardcodeados
-- (TARIFA_CIT en cotizacion.service.ts, nunca importado) o en variables de
-- entorno (RODAID_TASA_CIT_ARS / RODAID_RETRIBUCION_ALIADO_PCT en
-- compensaciones.service.ts), lo que exigia un redeploy para ajustarlos. Esta
-- tabla los centraliza como parametros editables en caliente (panel admin o SQL
-- directo) mientras se migra el modelo de un CIT unico a CIT Express / CIT
-- Completo (ver Prompt de Pricing CIT).
--
-- 'tasa_cit_oficial_ars' y 'retribucion_aliado_pct_generico' son el modelo
-- generico previo (Hito 5/11: retribucion al Taller Aliado como % de la tasa
-- oficial por CUALQUIER CIT validado); se conservan porque
-- registrarRetribucionAliado() en compensaciones.service.ts los sigue usando
-- hasta que ese flujo se reemplace producto por producto en las fases
-- siguientes. Las claves 'cit_express_*' y 'cit_completo_*' son el modelo nuevo.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

CREATE TABLE IF NOT EXISTS parametros_pricing_cit (
  clave VARCHAR(60) PRIMARY KEY,
  valor NUMERIC(12,4) NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('monto_ars', 'monto_usd', 'porcentaje')),
  descripcion TEXT NOT NULL,
  actualizado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reutiliza la funcion de touch creada en el Hito 1 (usuarios) para mantener
-- updated_at al dia en cada UPDATE, igual que en `aliados`.
DROP TRIGGER IF EXISTS trg_parametros_pricing_cit_updated_at ON parametros_pricing_cit;
CREATE TRIGGER trg_parametros_pricing_cit_updated_at
  BEFORE UPDATE ON parametros_pricing_cit
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();

INSERT INTO parametros_pricing_cit (clave, valor, tipo, descripcion) VALUES
  ('tasa_cit_oficial_ars', 18000, 'monto_ars',
   'Tasa CIT oficial cobrada por el canal MxM (Hito 13, tasa-cit.service.ts). No confundir con el precio comercial de CIT Express/Completo.'),
  ('retribucion_aliado_pct_generico', 0.30, 'porcentaje',
   'Fraccion de la tasa CIT oficial que retribuye al Taller Aliado por la validacion generica (Hito 5/11), previa al modelo Express/Completo.'),

  ('cit_express_precio_ars', 5100, 'monto_ars',
   'Precio final de CIT Express (autoregistro). Ajustar si el Ministerio de Seguridad de Mendoza lo declara obligatorio con tarifa regulada.'),
  ('cit_express_fee_taller_rojo_ars', 3000, 'monto_ars',
   'Pago fijo al Taller Aliado por la verificacion presencial cuando CIT Express clasifica en nivel ROJO.'),

  ('cit_completo_precio_publicado_ars', 28500, 'monto_ars',
   'Precio publicado del CIT Completo (certificacion de 20 puntos + Marketplace).'),
  ('cit_completo_costo_variable_ars', 283, 'monto_ars',
   'Costo variable por unidad de CIT Completo (calcomania QR pedida en lote).'),
  ('cit_completo_fee_verificacion_ars', 18000, 'monto_ars',
   'Fee de Verificacion Tecnica del CIT Completo. 100% Taller Aliado. Se financia con la sena del comprador al confirmarse la reserva, nunca con cargo al vendedor.'),
  ('cit_completo_fee_logistica_ars', 20000, 'monto_ars',
   'Fee de Logistica de Ejecucion. RODAID lo cobra al comprador a valor de costo (sin margen); 100% Taller Aliado. Solo se cobra si la venta se ejecuta.'),
  ('cit_completo_fee_exito_pct', 0.02, 'porcentaje',
   'Fee de Exito sobre el valor de venta de la bici. Solo se cobra si la venta se ejecuta.'),
  ('cit_completo_fee_exito_split_rodaid_pct', 0.50, 'porcentaje',
   'Particion del Fee de Exito que corresponde a RODAID; el resto (1 - este valor) va al Taller Aliado.'),
  ('cit_completo_umbral_premium_usd', 1000, 'monto_usd',
   'Umbral de valor de bici (USD, convertir con cotizacion.service.ts) por debajo del cual se sugiere CIT Express en vez de Completo en el flujo de publicacion.')
ON CONFLICT (clave) DO NOTHING;
