-- RODAID — Esquema 3: reclamo de titularidad (venta fuera de la plataforma,
-- sin usar /transferir ni el Marketplace).
--
-- Diseño acordado con Federico 2026-07-12 (ver CLAUDE.md, sección "Esquema
-- 3 — Reclamo de titularidad") y confirmado para construir 2026-07-23:
--   - Notificación automática y obligatoria al dueño actual registrado al
--     abrirse el reclamo, con 48hs para responder.
--   - Dueño niega -> rechazo automático + antecedente grave para el
--     reclamante. Dueño confirma -> aprobación directa (el interesado real
--     ya lo avaló), sin revisión humana. Silencio tras 48hs -> revisión
--     humana, con un cruce automático contra la base de robadas del
--     Ministerio (mismo mecanismo que clasificarNivelCIT()/
--     ejecutarCrossReference() ya usan para CIT Express) como CONTEXTO para
--     el revisor, nunca como decisión automática -- ni siquiera un
--     resultado ROJO aprueba o rechaza solo, siempre lo decide un humano.
--   - Revisor: staff/admin existente (moderacion:accion), sin rol nuevo.
--
-- VARCHAR + CHECK en `estado` (no ENUM nativo) -- mismo criterio que
-- disputas_cit_completo.estado: esta área todavía puede seguir evolucionando
-- (ver Esquema 4, jurisprudencia), evita la regla de los dos deploys cada
-- vez que aparezca un estado nuevo.
--
-- Roll-forward: no toca ninguna migración ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) El reclamo en sí.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reclamos_titularidad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id),
  cit_id UUID NOT NULL REFERENCES cits (id),
  reclamante_id UUID NOT NULL REFERENCES usuarios (id),
  propietario_actual_id UUID NOT NULL REFERENCES usuarios (id),
  estado VARCHAR(30) NOT NULL DEFAULT 'ESPERANDO_DUENO'
    CHECK (estado IN (
      'ESPERANDO_DUENO',
      'RECHAZADO_DUENO_NIEGA',
      'EN_REVISION_HUMANA',
      'APROBADO_DUENO_CONFIRMA',
      'APROBADO_HUMANO',
      'DESESTIMADO_HUMANO'
    )),
  motivo TEXT NOT NULL,
  responde_antes_de TIMESTAMPTZ NOT NULL,
  dueno_respuesta VARCHAR(10) CHECK (dueno_respuesta IN ('niega', 'confirma')),
  dueno_respondio_en TIMESTAMPTZ,
  cross_reference_nivel VARCHAR(10) CHECK (cross_reference_nivel IN ('AMARILLO', 'ROJO')),
  cross_reference_motivo TEXT,
  revisor_id UUID REFERENCES usuarios (id),
  resolucion_nota TEXT,
  transferencia_id UUID REFERENCES cit_transferencias (id),
  abierto_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un solo reclamo "vivo" (no resuelto) por bici a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reclamos_titularidad_unico_vivo_por_bici
  ON reclamos_titularidad (bicicleta_id)
  WHERE estado IN ('ESPERANDO_DUENO', 'EN_REVISION_HUMANA');

CREATE INDEX IF NOT EXISTS idx_reclamos_titularidad_reclamante
  ON reclamos_titularidad (reclamante_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reclamos_titularidad_dueno
  ON reclamos_titularidad (propietario_actual_id, created_at DESC);

-- Barrido del worker de vencimiento (48hs sin respuesta del dueño).
CREATE INDEX IF NOT EXISTS idx_reclamos_titularidad_esperando_vencido
  ON reclamos_titularidad (responde_antes_de)
  WHERE estado = 'ESPERANDO_DUENO';

-- Cola de revisión humana (admin).
CREATE INDEX IF NOT EXISTS idx_reclamos_titularidad_en_revision
  ON reclamos_titularidad (created_at ASC)
  WHERE estado = 'EN_REVISION_HUMANA';

-- Antecedentes del reclamante (dueño negó la venta) -- mismo patrón que
-- contarAntecedentesTaller(): sin tabla de reputación aparte, se cuenta
-- directo sobre esta tabla.
CREATE INDEX IF NOT EXISTS idx_reclamos_titularidad_reclamante_negado
  ON reclamos_titularidad (reclamante_id, resuelto_en)
  WHERE estado = 'RECHAZADO_DUENO_NIEGA';

-- ---------------------------------------------------------------------------
-- 2) Evidencia (tabla hija: reclamante Y dueño actual pueden subir archivos).
--    Mismo patrón que disputa_cit_completo_evidencias -- bucket cifrado
--    aparte (RODAID_RECLAMO_AES_KEY, ver cifrado.service.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reclamo_titularidad_evidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reclamo_id UUID NOT NULL REFERENCES reclamos_titularidad (id) ON DELETE CASCADE,
  subido_por_id UUID NOT NULL REFERENCES usuarios (id),
  subido_por_rol VARCHAR(12) NOT NULL CHECK (subido_por_rol IN ('reclamante', 'dueno_actual')),
  blob_key TEXT NOT NULL,
  nombre_archivo TEXT,
  content_type VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3) cit_transferencias.motivo -- extender el CHECK para el motivo nuevo.
--    VARCHAR + CHECK, no enum nativo -- no aplica la regla de los dos
--    deploys (esa es solo para ALTER TYPE ... ADD VALUE sobre un tipo ENUM).
-- ---------------------------------------------------------------------------
ALTER TABLE cit_transferencias DROP CONSTRAINT IF EXISTS cit_transferencias_motivo_check;
ALTER TABLE cit_transferencias ADD CONSTRAINT cit_transferencias_motivo_check
  CHECK (motivo IN ('venta_marketplace', 'transferencia_manual', 'reclamo_con_evidencia'));
