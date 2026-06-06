// db/index.ts — cliente de Netlify Database (Postgres gestionado).
//
// Conexión configurada automáticamente por la plataforma (sin connection
// string). Se usa el driver nativo `@netlify/database` con SQL tagueado
// (waddler) para las consultas de analítica, que requieren agregaciones
// (COUNT(*) FILTER, percentile_cont, GROUP BY) poco prácticas vía ORM.

import { getDatabase } from '@netlify/database'

export function getDb() {
  // getDatabase puede lanzar si el entorno de DB no está disponible (p. ej.
  // type-check local). Los llamadores envuelven en try/catch y degradan.
  return getDatabase()
}
