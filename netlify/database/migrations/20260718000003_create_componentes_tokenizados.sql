-- RODAID — Checklist de 20 puntos, "CIT Completo Plus": tokenizacion de
-- componentes de alto valor (marca/modelo/numero de serie) para 5 de los 20
-- puntos del checklist (lib/puntos-inspeccion.ts::PUNTOS_CON_COMPONENTE):
-- P06 (Horquilla), P08/P09 (Rueda delantera/trasera), P11/P12 (Freno
-- delantero/trasero). Exclusivo de CIT Completo -- CIT Express no tiene
-- ciclo de inspeccion fisica y no puede capturar un serial de forma
-- confiable.
--
-- Tabla dedicada, no una columna mas en checklist_detalle (JSONB): a
-- diferencia de los otros 15 puntos (pass/fail + nota, se leen siempre
-- junto con su inspeccion padre), un componente tokenizado necesita (a) una
-- constraint UNIQUE real entre TODAS las inspecciones -- el mismo numero de
-- serie de una horquilla no puede aparecer en dos bicis distintas -- y (b)
-- identidad propia como pieza fisica, que en el futuro podria necesitar su
-- propio historial si se reemplaza en una inspeccion posterior. Un UNIQUE
-- sobre un campo dentro de JSONB es fragil; sobre una columna real es
-- trivial.
--
-- bicicleta_id desnormalizado (ya esta en inspecciones_fisicas via
-- inspeccion_id): a proposito, para que el chequeo de duplicados de serial
-- no necesite un join contra inspecciones_fisicas en cada intento de carga.
--
-- categoria es un snapshot de PUNTOS_INSPECCION.categoria al momento de la
-- captura, no un FK -- si la taxonomia de lib/puntos-inspeccion.ts cambia
-- en el futuro, una fila ya guardada no debe cambiar de categoria
-- retroactivamente.
--
-- foto_blob_key: misma logica que denuncias_mpf.pdf_blob_key -- solo la
-- referencia al blob. La imagen vive cifrada en reposo (AES-256-GCM,
-- cifrarBytesInspeccion()/descifrarBytesInspeccion(), clave propia
-- RODAID_INSPECCION_AES_KEY) en su propio bucket de Netlify Blobs, nunca en
-- esta fila ni en claro.
--
-- El CHECK sobre punto_id fija los 5 valores de hoy (P06/P08/P09/P11/P12).
-- Cuando se cierre la fase futura de P13/P14 (zona gris, ver CLAUDE.md), esa
-- constraint necesita su propia migracion para ampliarse -- no es un
-- olvido, es deliberado: no constraint-ear a valores que todavia no existen.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

CREATE TABLE IF NOT EXISTS componentes_tokenizados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspeccion_id UUID NOT NULL REFERENCES inspecciones_fisicas (id) ON DELETE CASCADE,
  bicicleta_id UUID NOT NULL REFERENCES bicicletas (id) ON DELETE CASCADE,
  punto_id VARCHAR(4) NOT NULL CHECK (punto_id IN ('P06', 'P08', 'P09', 'P11', 'P12')),
  categoria VARCHAR(60) NOT NULL,
  marca VARCHAR(120),
  modelo VARCHAR(120),
  numero_serie VARCHAR(120),
  foto_blob_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A lo sumo un numero de serie vigente en toda la plataforma (entre bicis
-- distintas). Parcial: no todo componente reemplazado tiene un serial
-- grabado y legible.
CREATE UNIQUE INDEX IF NOT EXISTS idx_componentes_tokenizados_serie_unica
  ON componentes_tokenizados (numero_serie)
  WHERE numero_serie IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_componentes_tokenizados_inspeccion
  ON componentes_tokenizados (inspeccion_id);
CREATE INDEX IF NOT EXISTS idx_componentes_tokenizados_bicicleta
  ON componentes_tokenizados (bicicleta_id);
