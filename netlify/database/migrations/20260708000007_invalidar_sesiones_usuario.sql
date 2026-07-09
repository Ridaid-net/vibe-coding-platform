-- RODAID — Invalidacion forzada de sesion (revocacion remota ante robo de
-- dispositivo).
--
-- Complementa la revocacion de RefreshToken ya existente (tabla `sesiones`),
-- que solo impide sacar un AccessToken NUEVO. El AccessToken (JWT de 15
-- minutos) nunca se persiste ni se consulta contra la base en cada request
-- -- es stateless a proposito -- asi que hasta ahora no habia forma de matar
-- un AccessToken YA emitido antes de que expire por si solo.
--
-- `sesion_invalidada_desde`: watermark. requireAuth() rechaza cualquier
-- AccessToken cuyo `iat` (emitido en) sea anterior a esta marca — un solo
-- UPDATE invalida de golpe TODOS los AccessTokens ya emitidos para ese
-- usuario, sin distinguir dispositivo (para el caso de robo, eso es lo que
-- se quiere: matar todo, no una sesion puntual).
--
-- `sesion_invalidada_por` / `sesion_invalidada_motivo`: rastro de auditoria
-- de quien disparo la invalidacion y por que, mismo patron que
-- aliados.resuelto_por / motivo_rechazo.
--
-- Roll-forward: no toca ninguna migracion ya aplicada. Idempotente.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS sesion_invalidada_desde TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sesion_invalidada_por UUID REFERENCES usuarios (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sesion_invalidada_motivo TEXT;
