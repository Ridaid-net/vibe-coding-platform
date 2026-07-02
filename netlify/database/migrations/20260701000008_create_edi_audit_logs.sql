CREATE TABLE IF NOT EXISTS edi_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID NOT NULL,
  servicio VARCHAR(128) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  estado VARCHAR(10) NOT NULL CHECK (estado IN ('EXITO', 'ERROR')),
  codigo_respuesta INTEGER NOT NULL DEFAULT 0,
  duracion_ms INTEGER NOT NULL DEFAULT 0,
  payload_hash VARCHAR(64),
  respuesta_hash VARCHAR(64),
  error TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS edi_audit_logs_transaccion_idx ON edi_audit_logs(transaccion_id);
CREATE INDEX IF NOT EXISTS edi_audit_logs_servicio_idx ON edi_audit_logs(servicio);
CREATE INDEX IF NOT EXISTS edi_audit_logs_estado_idx ON edi_audit_logs(estado);
