-- RODAID — Reintento confiable de la notificacion de denuncia judicial al
-- Ministerio de Seguridad de Mendoza.
--
-- Hasta esta migracion, notificarDenunciaJudicial() (ministerio.service.ts)
-- era fire-and-forget: activarDenuncia() (denuncia-mpf.service.ts) la
-- envolvia en un .catch() que solo loguea -- una notificacion perdida a
-- fuerzas de seguridad no dejaba nada reintentable. Mismo patron que
-- cits.bfa_estado (blockchain.service.ts): estado persistido + intentos +
-- barrido periodico (worker cada 5 min, igual que bfa-anclaje-worker.mts).

ALTER TABLE denuncias_mpf
  ADD COLUMN IF NOT EXISTS ministerio_estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (ministerio_estado IN ('pendiente', 'notificando', 'enviado', 'error')),
  ADD COLUMN IF NOT EXISTS ministerio_intentos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ministerio_ultimo_error TEXT,
  ADD COLUMN IF NOT EXISTS ministerio_notificado_en TIMESTAMPTZ;

-- Backfill: las denuncias que ya estaban DENUNCIA_JUDICIAL_ACTIVA antes de esta
-- migracion ya pasaron por activarDenuncia() al menos una vez (LIVE o SIMULADO
-- segun la config del momento) -- se marcan 'enviado' para que el nuevo worker
-- no las reintente en bloque el dia que se configure la URL real del
-- Ministerio (evita un alud de notificaciones de casos viejos justo antes de
-- la reunion del 2026-07-15).
UPDATE denuncias_mpf
  SET ministerio_estado = 'enviado', ministerio_notificado_en = actualizado_en
  WHERE estado = 'DENUNCIA_JUDICIAL_ACTIVA' AND ministerio_estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_denuncias_mpf_ministerio_pendiente
  ON denuncias_mpf (ministerio_estado) WHERE ministerio_estado IN ('pendiente', 'error');
