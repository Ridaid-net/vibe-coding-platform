-- RODAID — Checklist Premium: suspensión trasera, suspensión delantera con
-- bloqueo, tija telescópica, cambios/shifters electrónicos, pata de cambio,
-- motor y batería de e-bike. Estándar propio de RODAID (confirmado por
-- Federico: la Ley 9.556 no exige estos 20 puntos, son un piso propio de
-- RODAID por encima del mínimo legal -- sin restricción normativa para
-- extenderlo), separado del checklist base de 20 por prolijidad de
-- producto -- ver lib/puntos-inspeccion.ts::PUNTOS_INSPECCION_PREMIUM, una
-- lista propia que calcularResultadoChecklist() nunca toca (el módulo
-- premium no gatea la aprobación del CIT, es puramente informativo /
-- antifraude / de valor de reventa).
--
-- Reusa componentes_tokenizados (misma tabla que ya tokeniza horquilla/
-- ruedas/frenos) en vez de una tabla nueva -- misma lógica de captura
-- (marca/modelo/serial/foto), mismo mecanismo de UNIQUE de serial entre
-- bicis distintas. Los 8 punto_id nuevos usan el prefijo "PR" (Premium) en
-- vez de continuar la numeración P21.. -- distinción visual a propósito,
-- para que nunca se confunda con los 20 puntos base a simple vista en una
-- fila de datos.
--
-- especificaciones JSONB: NULL para los 5 puntos base y para PR01-PR06
-- (marca/modelo/serial ya alcanza -- una suspensión Fox se identifica igual
-- que una horquilla). Solo la usan PR07 (motor: potencia_w) y PR08
-- (batería: capacidad_wh, voltaje, ciclos_carga_estimados) -- dato real de
-- seguridad, no solo comercial: una batería de litio dañada es riesgo de
-- incendio. JSONB genérico (no columnas tipadas fijas) a propósito: deja
-- espacio para datos de APIs futuras (ej. Bosch, SRAM AXS -- ver
-- segundo-cerebro/, investigación externa 2026-07-18) sin necesitar otra
-- migración cuando esas integraciones se conecten.
--
-- El CHECK original sobre punto_id no tenía nombre explícito (CHECK inline
-- en la definición de columna) -- se localiza dinámicamente vía
-- information_schema en vez de asumir el nombre autogenerado por Postgres,
-- para no arriesgar un DROP CONSTRAINT contra un nombre adivinado.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente (el DO
-- block solo actua si encuentra un CHECK viejo con los 5 valores originales;
-- si ya corrió esta migración antes, el constraint ya tiene los 13 valores
-- y el bloque no hace nada).

DO $$
DECLARE
  nombre_constraint TEXT;
BEGIN
  SELECT con.conname INTO nombre_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'componentes_tokenizados'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%punto_id%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%PR01%';

  IF nombre_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE componentes_tokenizados DROP CONSTRAINT %I', nombre_constraint);
    ALTER TABLE componentes_tokenizados
      ADD CONSTRAINT componentes_tokenizados_punto_id_check
        CHECK (punto_id IN (
          'P06', 'P08', 'P09', 'P11', 'P12',
          'PR01', 'PR02', 'PR03', 'PR04', 'PR05', 'PR06', 'PR07', 'PR08'
        ));
  END IF;
END
$$;

ALTER TABLE componentes_tokenizados ADD COLUMN IF NOT EXISTS especificaciones JSONB;
