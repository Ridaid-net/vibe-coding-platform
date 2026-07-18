-- RODAID — Checklist Premium (suspensión trasera / e-bike): atributo
-- permanente de la bici, declarado por el dueño/taller al cargarla o
-- editarla -- NO se infiere de una inspeccion puntual (una inspeccion es un
-- evento, esto es un dato estructural de la bici).
--
-- Nullable, sin default: NULL = "no declarado todavia" (bicis cargadas antes
-- de este cambio, o el dueño no lo especifico), distinguible de FALSE =
-- "confirmado rigida". El codigo que decide si mostrar un punto premium de
-- suspension trasera trata NULL igual que FALSE (nunca mostrar un checklist
-- para un dato no declarado), pero el valor en si queda honesto para calidad
-- de datos en vez de forzar un default que convertiria en falso "no sabemos"
-- para todo el parque de bicis existente.
--
-- Simple ALTER TABLE: bicicletas.tipo no es un enum de Postgres (VARCHAR sin
-- CHECK), no aplica la regla de dos deploys de ALTER TYPE ... ADD VALUE.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

ALTER TABLE bicicletas ADD COLUMN IF NOT EXISTS suspension_trasera BOOLEAN;
