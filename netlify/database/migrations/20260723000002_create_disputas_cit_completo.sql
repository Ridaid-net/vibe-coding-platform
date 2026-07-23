-- RODAID — Esquema 1 Caso B: disputa comprador/vendedor de CIT Completo.
--
-- El mecanismo generico existente (abrirDisputa()/resolverDisputa() sobre
-- escrow_transacciones.estado = 'DISPUTADA') NO sirve para CIT Completo:
-- referencia los estados 'ACTIVA'/'PAUSADA' del flujo viejo de
-- marketplace_publicaciones, que una publicacion CIT Completo nunca alcanza.
-- Este es un mecanismo nuevo, independiente, para esta familia de estados
-- (PUBLICADO_CERTIFICADO/RESERVADO/RESERVADA/EJECUTANDO_LOGISTICA/
-- FONDOS_RETENIDOS).
--
-- Diseño acordado con Federico 2026-07-23 (ver CLAUDE.md, seccion "Esquema
-- de disputas CIT Transferencia" + la sesion que cerro este diseño):
--   - Reputacion en escalones: 1ra cancelacion con evidencia -> AMARILLO
--     automatico (sin humano). 2da+ -> SIEMPRE revision humana antes de
--     cualquier sancion.
--   - Extinguir la cuenta del vendedor nunca es automatico -- decision manual
--     aparte, no modelada en este enum.
--   - VARCHAR + CHECK en vez de ENUM nativo para los 4 estados nuevos: esta
--     es la parte del diseño de disputas que mas va a seguir evolucionando
--     (jurisprudencia, canon todavia sin construir) -- evita la regla de los
--     dos deploys cada vez que aparezca un estado nuevo. Mismo patron que
--     usuarios.estado (tambien VARCHAR, no ENUM).
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Prioridad de recompra de 3 dias habiles (Esquema 1 Caso A).
--    Se estampa en la misma fila que ya pasa a RESERVA_VENCIDA
--    (procesarReservasVencidas(), escrow.service.ts) -- sin tabla nueva.
-- ---------------------------------------------------------------------------
ALTER TABLE escrow_transacciones
  ADD COLUMN IF NOT EXISTS prioridad_recompra_vence_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_escrow_tx_prioridad_recompra
  ON escrow_transacciones (publicacion_id, prioridad_recompra_vence_en)
  WHERE prioridad_recompra_vence_en IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) La disputa en si (Esquema 1 Caso B).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disputas_cit_completo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_transaccion_id UUID NOT NULL REFERENCES escrow_transacciones (id),
  publicacion_id UUID NOT NULL REFERENCES marketplace_publicaciones (id),
  comprador_id UUID NOT NULL REFERENCES usuarios (id),
  vendedor_id UUID NOT NULL REFERENCES usuarios (id),
  estado VARCHAR(24) NOT NULL DEFAULT 'ABIERTA'
    CHECK (estado IN ('ABIERTA', 'RESUELTA_AMARILLO', 'EN_REVISION_HUMANA', 'CONFIRMADA_NARANJA', 'DESESTIMADA')),
  motivo TEXT NOT NULL,
  numero_cancelacion_del_vendedor INT NOT NULL CHECK (numero_cancelacion_del_vendedor > 0),
  monto_reembolsado_ars NUMERIC(12,2),
  revisor_id UUID REFERENCES usuarios (id),
  resolucion_nota TEXT,
  abierta_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola disputa "viva" (no resuelta) por transaccion.
CREATE UNIQUE INDEX IF NOT EXISTS idx_disputas_cit_unica_viva_por_tx
  ON disputas_cit_completo (escrow_transaccion_id)
  WHERE estado IN ('ABIERTA', 'EN_REVISION_HUMANA');

CREATE INDEX IF NOT EXISTS idx_disputas_cit_vendedor
  ON disputas_cit_completo (vendedor_id, created_at DESC);

-- Cola de revision humana (admin).
CREATE INDEX IF NOT EXISTS idx_disputas_cit_en_revision
  ON disputas_cit_completo (created_at ASC)
  WHERE estado = 'EN_REVISION_HUMANA';

-- ---------------------------------------------------------------------------
-- 3) Evidencia (tabla hija: comprador Y vendedor pueden subir archivos).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disputa_cit_completo_evidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disputa_id UUID NOT NULL REFERENCES disputas_cit_completo (id) ON DELETE CASCADE,
  subido_por_id UUID NOT NULL REFERENCES usuarios (id),
  subido_por_rol VARCHAR(12) NOT NULL CHECK (subido_por_rol IN ('comprador', 'vendedor')),
  blob_key TEXT NOT NULL,
  nombre_archivo TEXT,
  content_type VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputa_evidencias_disputa
  ON disputa_cit_completo_evidencias (disputa_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- 4) Reputacion acumulada por vendedor (una fila por usuario).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reputacion_vendedores (
  usuario_id UUID PRIMARY KEY REFERENCES usuarios (id),
  cancelaciones_confirmadas INT NOT NULL DEFAULT 0 CHECK (cancelaciones_confirmadas >= 0),
  estado VARCHAR(16) NOT NULL DEFAULT 'normal'
    CHECK (estado IN ('normal', 'amarillo', 'naranja', 'extinguida')),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5) Deuda hacia RODAID (2da+ cancelacion confirmada por revision humana).
--    Bloquea publicar un CIT Completo nuevo hasta saldarse -- mismo patron
--    que el gate de datos_bancarios_payout en /api/v1/marketplace/publicar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deudas_vendedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios (id),
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  motivo TEXT NOT NULL,
  disputa_id UUID REFERENCES disputas_cit_completo (id),
  estado VARCHAR(12) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'pagada', 'condonada')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pagada_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deudas_vendedores_usuario_pendiente
  ON deudas_vendedores (usuario_id)
  WHERE estado = 'pendiente';
