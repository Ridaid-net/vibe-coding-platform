-- RODAID — Fase 1: Comision de pasarela sobre el Fee de Logistica del CIT Completo.
--
-- El Fee de Logistica ($20.000) se le PAGA al Taller Aliado integro, a valor de
-- costo. Pero RODAID lo cobra al comprador vía MercadoPago, que descuenta su
-- comision sobre ese cobro puntual. Si RODAID cobrara exactamente $20.000, la
-- comision de MercadoPago saldria de su propio margen (perdida en esa linea).
-- Por eso el monto que se cobra al comprador se ajusta hacia arriba:
--   feeLogisticaCobradoCompradorARS = feeLogisticaPagadoTallerARS / (1 - comision_pasarela_pct)
--
-- ADVERTENCIA: 0.055 (5.5%) es una ESTIMACION de trabajo usada en todo el
-- modelo de pricing, NO la tasa contractual confirmada con la cuenta real de
-- MercadoPago de RODAID. Federico debe validarla contra la tasa vigente (varia
-- segun modalidad de cobro: Checkout Pro, API directa, cuotas, etc.) antes de
-- llevar este parametro a produccion. Editable sin deploy vía
-- parametros_pricing_cit.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

INSERT INTO parametros_pricing_cit (clave, valor, tipo, descripcion) VALUES
  ('cit_completo_comision_pasarela_pct', 0.055, 'porcentaje',
   'ESTIMACION DE TRABAJO, NO CONFIRMADA con MercadoPago todavia. Comision de pasarela aplicada al cobro del Fee de Logistica al comprador (se ajusta el cobro hacia arriba para que el Taller Aliado siga recibiendo el monto integro). Validar contra la tasa real de la cuenta de MercadoPago de RODAID (varia por modalidad: Checkout Pro, API directa, cuotas) antes de produccion.')
ON CONFLICT (clave) DO NOTHING;
