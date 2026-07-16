-- RODAID — BiciSalud: historial de mantenimiento publico por rodado.
--
-- Auditoria de modelo de datos (2026-07-16): la Bici-Salud predictiva
-- (iot-mantenimiento.service.ts, Hito 17) hoy solo es visible para el dueno
-- ACTUAL -- iot_alertas guarda bicicleta_id (correcto, permanente) pero la
-- consulta real filtra ademas por usuario_id, asi que un comprador nuevo
-- pierde todo el historial mecanico de la bici que compro, aunque el CIT y la
-- bici sean los mismos de siempre. Decision explicita de Federico: el filtro
-- por usuario_id en iot-mantenimiento.service.ts NO se toca (protege
-- telemetria cruda/ubicacion del dueno anterior, a proposito) -- en su lugar,
-- esta vista expone SOLO los eventos de mantenimiento ya diagnosticados, sin
-- ningun dato personal ni de ubicacion.
--
-- Fuente: iot_alertas, no telemetria_historica directamente -- el diagnostico
-- (probabilidad/severidad por componente) lo calcula un modelo de IA
-- (Claude, ver iot-mantenimiento.service.ts::interpretarConModelo()), no algo
-- que una vista SQL pueda recalcular; iot_alertas es el resultado YA
-- decidido de ese analisis.
--
-- Columnas excluidas a proposito:
--   - usuario_id: el dato que rompe la privacidad del dueno anterior (el
--     motivo entero de esta vista).
--   - dispositivo_id: permitiria un join de vuelta a iot_dispositivos.usuario_id.
--   - dedupe_key, metadata: detalle de implementacion interna, sin valor para
--     un comprador.
--   - reconocida: se evaluo y se descarto a proposito -- solo significa "el
--     dueno vio la notificacion en la app", NUNCA "se resolvio el problema".
--     Dejarla hubiera sido peor que no tener nada: un comprador podria leer
--     "reconocida = true" como "ya se arreglo".
--
-- DISTINCT ON (bicicleta_id, tipo): se muestra solo el diagnostico MAS
-- RECIENTE por componente, no el historial completo -- sin esto, una alerta
-- de hace 8 meses ya resuelta por el dueno anterior seguiria apareciendo como
-- si estuviera vigente. Limitacion conocida, aceptada por Federico: si nadie
-- volvio a correr el analisis despues de un arreglo real, el diagnostico "mas
-- reciente" puede seguir mostrando la condicion vieja. No existe hoy ningun
-- mecanismo real de "esto se resolvio" (ver backlog en CLAUDE.md).
--
-- VISTA simple, no tabla materializada: la consulta subyacente es un filtro +
-- proyeccion de columnas sobre iot_alertas, ya con indice existente
-- (idx_iot_alertas_tipo), sin agregacion costosa que justifique materializar
-- con job de refresco. Se recalcula en el momento, siempre al dia, sin nada
-- que sincronizar.
--
-- Roll-forward: no toca ninguna migracion ya aplicada.

CREATE OR REPLACE VIEW bicisalud_resumen_publico AS
SELECT DISTINCT ON (bicicleta_id, tipo)
  bicicleta_id,
  tipo,
  severidad,
  titulo,
  mensaje,
  created_at
FROM iot_alertas
WHERE tipo IN ('mantenimiento_cadena', 'mantenimiento_cubiertas', 'mantenimiento_servicio')
ORDER BY bicicleta_id, tipo, created_at DESC;
