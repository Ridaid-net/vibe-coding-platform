-- RODAID — Historial Clinico publico del Garaje Digital: tabla de opt-in.
--
-- Habilita un link (y QR) publico y compartible por bici, sin exponer datos
-- del dueño -- combina lo que ya es seguro de mostrar (CIT + fecha_emision,
-- bicisalud_resumen_publico, scoreConfianza total+badge, resumen de
-- inspecciones_fisicas) detras de un identificador de acceso propio, no el
-- codigo_cit (parcialmente derivado del numero de serie, ~24 bits de entropia
-- real en el sufijo) ni el bicicleta_id interno (PK referenciada en decenas
-- de FKs, no revocable sin tocar la fila real de la bici).
--
-- Opt-in explicito: la generacion del token ES la activacion -- no hay un
-- flag de consentimiento separado. Ausencia de fila activa = no compartido.
--
-- Revocar nunca borra la fila (preserva el historial/analitica de vistas):
-- solo marca `revocado_en`. Reactivar despues de revocar crea una fila
-- NUEVA con un token NUEVO -- un link viejo filtrado en algun lado queda
-- muerto para siempre, aunque el dueño vuelva a activar el compartir.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

CREATE TABLE IF NOT EXISTS bicicletas_compartidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  -- El identificador publico real de la URL/QR. 128 bits, generado por la
  -- base (mismo mecanismo que toda otra PK de este schema) -- desacoplado a
  -- proposito de codigo_cit y de bicicleta_id.
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  activado_por UUID NOT NULL REFERENCES usuarios (id),
  activado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revocado_en TIMESTAMPTZ,
  vistas INTEGER NOT NULL DEFAULT 0,
  ultima_vista_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A lo sumo UN link activo por bici a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bicicletas_compartidas_activo
  ON bicicletas_compartidas (bicicleta_id)
  WHERE revocado_en IS NULL;

-- Lookup del endpoint publico (path caliente) -- solo tokens activos. La
-- consulta de la app SIEMPRE debe filtrar tambien `revocado_en IS NULL`
-- explicitamente: el indice parcial acelera esa consulta, no la reemplaza.
CREATE INDEX IF NOT EXISTS idx_bicicletas_compartidas_token
  ON bicicletas_compartidas (token)
  WHERE revocado_en IS NULL;
