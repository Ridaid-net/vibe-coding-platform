-- RODAID — Modulo 4: indices parciales del CIT que dependen de valores de enum.
-- Se aplica despues de extend_cit_estado_lifecycle para garantizar que el enum
-- cit_estado ya tiene todos los valores necesarios (incluido PENDIENTE_VALIDACION).

CREATE UNIQUE INDEX IF NOT EXISTS idx_cits_unico_vivo_por_bicicleta
  ON cits (bicicleta_id)
  WHERE estado IN ('PENDIENTE_VALIDACION', 'ACTIVO');

CREATE INDEX IF NOT EXISTS idx_cits_pipeline_expira
  ON cits (expira_en)
  WHERE estado = 'PENDIENTE_VALIDACION';

CREATE INDEX IF NOT EXISTS idx_cits_bfa_pendiente
  ON cits (bfa_estado)
  WHERE bfa_estado = 'PENDIENTE';
