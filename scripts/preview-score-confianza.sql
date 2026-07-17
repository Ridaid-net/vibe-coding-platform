-- RODAID — Preview puntual del Score de Confianza de la Bici (Garaje Digital).
--
-- Consulta de SOLO LECTURA, no es una migracion, no toca nada. Sirve para
-- calibrar los pesos de la formula (ver CLAUDE.md, seccion "Score de
-- Confianza de la Bici") antes de construir el badge en la UI. Reproduce
-- exactamente la logica de src/services/score-confianza.service.ts contra
-- datos reales: elige 4 bicis con distinto nivel de completitud y calcula
-- el desglose por factor.
--
-- Uso: pegar entero en la consola SQL de Neon y correr.

WITH candidatos AS (
  (SELECT bicicleta_id, 'con historial de talleres' AS motivo
   FROM inspecciones_fisicas
   WHERE resultado = 'APROBADA'
   GROUP BY bicicleta_id
   ORDER BY COUNT(*) DESC
   LIMIT 1)
  UNION ALL
  (SELECT bicicleta_id, 'con alertas BiciSalud activas' AS motivo
   FROM bicisalud_resumen_publico
   WHERE severidad IN ('alta', 'critica')
   GROUP BY bicicleta_id
   ORDER BY COUNT(*) DESC
   LIMIT 1)
  UNION ALL
  (SELECT d.bicicleta_id, 'con IoT vinculado, sin alertas' AS motivo
   FROM iot_dispositivos d
   WHERE NOT EXISTS (
     SELECT 1
     FROM bicisalud_resumen_publico v
     WHERE v.bicicleta_id = d.bicicleta_id
       AND v.severidad IN ('alta', 'critica')
   )
   LIMIT 1)
  UNION ALL
  (SELECT id, 'recien agregada / poca completitud' AS motivo
   FROM bicicletas
   ORDER BY created_at DESC
   LIMIT 1)
),

base AS (
  SELECT
    c.bicicleta_id,
    c.motivo,
    b.marca,
    b.modelo,
    cit.estado AS cit_estado,
    cit.metadata_json AS cit_metadata,
    b.created_at AS bici_creado_en,
    COALESCE(
      cit.estado = 'activo'
        AND (cit.fecha_vencimiento IS NULL OR cit.fecha_vencimiento > NOW()),
      FALSE
    ) AS cit_activo,
    EXISTS (
      SELECT 1
      FROM iot_dispositivos d
      WHERE d.bicicleta_id = c.bicicleta_id
    ) AS tiene_iot
  FROM candidatos c
  JOIN bicicletas b ON b.id = c.bicicleta_id
  LEFT JOIN LATERAL (
    SELECT *
    FROM cits
    WHERE cits.bicicleta_id = b.id
    ORDER BY
      CASE estado
        WHEN 'bloqueado' THEN 0
        WHEN 'activo' THEN 1
        WHEN 'pendiente' THEN 2
        ELSE 3
      END,
      acunado_en DESC
    LIMIT 1
  ) cit ON TRUE
),

talleres AS (
  SELECT
    bicicleta_id,
    LEAST(
      25,
      COALESCE(
        SUM(
          CASE
            WHEN created_at > NOW() - INTERVAL '12 months' THEN 6
            WHEN created_at > NOW() - INTERVAL '36 months' THEN 3
            ELSE 1
          END
        ),
        0
      )
    ) AS puntos
  FROM inspecciones_fisicas
  WHERE resultado = 'APROBADA'
    AND bicicleta_id IN (SELECT bicicleta_id FROM candidatos)
  GROUP BY bicicleta_id
),

bicisalud AS (
  SELECT
    bicicleta_id,
    COALESCE(
      SUM(
        CASE severidad
          WHEN 'critica' THEN 12
          WHEN 'alta' THEN 8
          ELSE 0
        END
      ),
      0
    ) AS deduccion
  FROM bicisalud_resumen_publico
  WHERE severidad IN ('alta', 'critica')
    AND bicicleta_id IN (SELECT bicicleta_id FROM candidatos)
  GROUP BY bicicleta_id
)

-- Una sola columna JSON por fila a proposito: pegar una tabla ancha desde la
-- consola de Neon puede desalinear columnas entre filas al copiar. Un objeto
-- JSON por bici es imposible de desalinear -- cada numero queda etiquetado.
SELECT jsonb_build_object(
  'bicicleta_id', base.bicicleta_id,
  'motivo', base.motivo,
  'marca', base.marca,
  'modelo', base.modelo,
  'cit_estado', base.cit_estado,
  'factor_cit', CASE
    WHEN NOT base.cit_activo THEN 0
    WHEN base.cit_metadata -> 'inspeccionFisica' ->> 'resultado' = 'APROBADA' THEN 35
    ELSE 15
  END,
  'factor_talleres', COALESCE(talleres.puntos, 0),
  'factor_bicisalud', CASE
    WHEN base.tiene_iot THEN GREATEST(0, 25 - COALESCE(bicisalud.deduccion, 0))
    ELSE 13
  END,
  'factor_antiguedad', LEAST(
    15,
    GREATEST(
      0,
      ROUND(15.0 * EXTRACT(EPOCH FROM (NOW() - base.bici_creado_en)) / 86400 / 365)
    )
  ),
  'total', (
    CASE
      WHEN NOT base.cit_activo THEN 0
      WHEN base.cit_metadata -> 'inspeccionFisica' ->> 'resultado' = 'APROBADA' THEN 35
      ELSE 15
    END
    + COALESCE(talleres.puntos, 0)
    + CASE
        WHEN base.tiene_iot THEN GREATEST(0, 25 - COALESCE(bicisalud.deduccion, 0))
        ELSE 13
      END
    + LEAST(
        15,
        GREATEST(
          0,
          ROUND(15.0 * EXTRACT(EPOCH FROM (NOW() - base.bici_creado_en)) / 86400 / 365)
        )
      )
  )
) AS resultado
FROM base
LEFT JOIN talleres ON talleres.bicicleta_id = base.bicicleta_id
LEFT JOIN bicisalud ON bicisalud.bicicleta_id = base.bicicleta_id;
