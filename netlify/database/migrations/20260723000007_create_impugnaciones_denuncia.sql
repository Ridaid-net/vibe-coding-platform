-- RODAID — Esquema 4: impugnación de denuncia falsa (vendedor deshonesto
-- denuncia DESPUÉS de vender por afuera de la plataforma).
--
-- Diseño acordado con Federico 2026-07-11/12 (ver CLAUDE.md, sección
-- "Esquema 4 — Impugnación de denuncia falsa") y confirmado para construir
-- 2026-07-23:
--   - Solo puede impugnar quien demuestre algún vínculo previo con la bici
--     -- medios de prueba jerarquizados (factura de compra > recibo de
--     escribano > fotos de posesión real > otro medio fehaciente >
--     testimonio de testigo, este último NUNCA determinante por sí solo).
--     No hay chequeo automático de "vínculo" posible (la venta ocurrió por
--     fuera de RODAID, el impugnante no tiene ningún registro previo acá) --
--     el vínculo se valida por revisión humana de la evidencia, no por SQL.
--   - Plazo: 15 días hábiles desde que la denuncia se activó, antes de que
--     quede firme.
--   - La impugnación SIEMPRE dispara revisión humana obligatoria -- a
--     diferencia del Esquema 3, no hay una parte que "responda" primero, así
--     que no hace falta un estado intermedio de espera ni un worker de
--     vencimiento.
--   - CONFIRMADO 2026-07-23: no existe en este repo ningún mecanismo real de
--     consulta de estado judicial contra el MPF (el único artefacto
--     encontrado fue un string sin usar, 'CONSULTAR_DENUNCIA', dentro del
--     X-Road/EDI ya documentado como código muerto y desconectado -- no
--     cuenta como integración real). Por eso el levantamiento REAL del
--     bloqueo sobre la bici/CIT queda DELIBERADAMENTE sin implementar en
--     esta pasada: el estado terminal
--     'CONFIRMADA_FALSA_PENDIENTE_LEVANTAMIENTO_MANUAL' es el final del
--     camino de este sistema -- deja la decisión y toda la evidencia
--     visibles para un admin, pero no ejecuta ningún desbloqueo automático.
--     Levantar el bloqueo de verdad (tocar denuncias_mpf/cits) queda para
--     cuando exista una integración real con el MPF, en una pasada aparte.
--
-- VARCHAR + CHECK en `estado` (no ENUM nativo) -- mismo criterio que
-- disputas_cit_completo.estado/reclamos_titularidad.estado.
--
-- Roll-forward: no toca ninguna migración ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) La impugnación en sí.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impugnaciones_denuncia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id UUID NOT NULL REFERENCES denuncias_mpf (id),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  denunciante_id UUID NOT NULL,
  impugnante_id UUID NOT NULL REFERENCES usuarios (id),
  estado VARCHAR(48) NOT NULL DEFAULT 'EN_REVISION_HUMANA'
    CHECK (estado IN (
      'EN_REVISION_HUMANA',
      'CONFIRMADA_FALSA_PENDIENTE_LEVANTAMIENTO_MANUAL',
      'DESESTIMADA'
    )),
  motivo TEXT NOT NULL,
  medio_prueba_principal VARCHAR(24) NOT NULL
    CHECK (medio_prueba_principal IN (
      'factura_compra',
      'recibo_escribano',
      'fotos_posesion',
      'otro_fehaciente',
      'testimonio_testigo'
    )),
  revisor_id UUID REFERENCES usuarios (id),
  resolucion_nota TEXT,
  abierta_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola impugnación "viva" (en revisión) por denuncia a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_impugnaciones_denuncia_unica_viva
  ON impugnaciones_denuncia (denuncia_id)
  WHERE estado = 'EN_REVISION_HUMANA';

CREATE INDEX IF NOT EXISTS idx_impugnaciones_denuncia_impugnante
  ON impugnaciones_denuncia (impugnante_id, created_at DESC);

-- Cola de revisión humana (admin).
CREATE INDEX IF NOT EXISTS idx_impugnaciones_denuncia_en_revision
  ON impugnaciones_denuncia (created_at ASC)
  WHERE estado = 'EN_REVISION_HUMANA';

-- Antecedentes del denunciante (denuncias suyas confirmadas como falsas) --
-- mismo criterio que contarReclamosNegados()/contarAntecedentesTaller(): sin
-- tabla de reputación aparte, se cuenta directo sobre esta tabla.
CREATE INDEX IF NOT EXISTS idx_impugnaciones_denuncia_denunciante_confirmada
  ON impugnaciones_denuncia (denunciante_id, resuelta_en)
  WHERE estado = 'CONFIRMADA_FALSA_PENDIENTE_LEVANTAMIENTO_MANUAL';

-- ---------------------------------------------------------------------------
-- 2) Evidencia (tabla hija: quien impugna sube archivos). Mismo patrón que
--    disputa_cit_completo_evidencias/reclamo_titularidad_evidencias --
--    bucket cifrado aparte (RODAID_IMPUGNACION_AES_KEY, ver
--    cifrado.service.ts). Deliberadamente NO se unifica con esas dos tablas
--    (ver la nota de revisión cruzada en CLAUDE.md): son estructuralmente
--    iguales a propósito, no por descuido -- cada dominio de cifrado
--    independiente acota el radio de daño si alguna clave se compromete, y
--    fusionarlas exigiría migrar datos ya en producción por una ganancia
--    puramente cosmética.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impugnacion_denuncia_evidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impugnacion_id UUID NOT NULL REFERENCES impugnaciones_denuncia (id) ON DELETE CASCADE,
  subido_por_id UUID NOT NULL REFERENCES usuarios (id),
  blob_key TEXT NOT NULL,
  nombre_archivo TEXT,
  content_type VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
