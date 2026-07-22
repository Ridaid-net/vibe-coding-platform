-- RODAID — "Uso autorizado": hasta 2 personas adicionales por bici,
-- cargadas por el dueño desde el Garaje Digital, que pueden circular con
-- ella de forma legítima.
--
-- Integracion con la verificacion: si un tercero autorizado circula con la
-- bici y lo verifica la Policia, la lista de autorizados aparece como
-- prueba de uso legitimo -- pero el DNI y la direccion son datos sensibles
-- (Ley 25.326) y NUNCA deben quedar expuestos a cualquiera que consulte la
-- bici publicamente. Diseno de exposicion, confirmado con Federico
-- 2026-07-22:
--   - Verificador publico (buscarYVerificar()): solo un booleano
--     (usoAutorizado) + cantidad -- nunca nombre/DNI/direccion/telefono.
--   - gov/verificar: mismo booleano/cantidad por default para TODOS los
--     tenants (comparten un unico token, GOV_API_TOKEN) -- el array
--     completo (nombre/DNI/direccion/telefono) SOLO se incluye cuando
--     tenantSlug === 'ministerio_seguridad'. MPF y municipios ven lo mismo
--     que el publico.
--
-- dni_cifrado/direccion_cifrada: AES-256-GCM con una clave INDEPENDIENTE
-- (RODAID_AUTORIZADOS_AES_KEY, ver cifrado.service.ts) -- mismo patron que
-- Ministerio/IoT/denuncias/inspeccion, nunca reusa la clave de otro
-- dominio. nombre_completo/telefono en claro (no se pidieron cifrados).
--
-- El tope de "hasta 2 por bici" es una regla de APLICACION (el servicio
-- cuenta antes de insertar, 409 en el tercero) -- no un constraint de base,
-- mismo criterio que el resto del repo para reglas de conteo.

CREATE TABLE IF NOT EXISTS bicicletas_autorizados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,

  nombre_completo VARCHAR(160) NOT NULL,
  dni_cifrado TEXT NOT NULL,
  direccion_cifrada TEXT NOT NULL,
  telefono VARCHAR(40),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bicicletas_autorizados_bici
  ON bicicletas_autorizados (bicicleta_id);

DROP TRIGGER IF EXISTS trg_bicicletas_autorizados_updated_at ON bicicletas_autorizados;
CREATE TRIGGER trg_bicicletas_autorizados_updated_at
  BEFORE UPDATE ON bicicletas_autorizados
  FOR EACH ROW
  EXECUTE FUNCTION usuarios_touch_updated_at();
