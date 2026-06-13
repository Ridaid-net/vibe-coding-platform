import { CATEGORIAS } from '@/lib/cit'
import {
  getColaTrabajo,
  getResumenHoy,
  getTalleres,
} from '@/src/services/cit.service'
import { InspectorPanel } from './inspector-panel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Panel de Inspector · RODAID',
  description:
    'Taller aliado: registro de los 20 puntos de control del CIT (Certificado de Inspeccion Tecnica).',
}

/**
 * Panel de Gestion del Inspector — pantalla del taller aliado.
 *
 * Carga la cola de trabajo, los talleres y los KPIs del dia desde la base y
 * delega la interaccion (los 20 puntos -> APROBADO | RECHAZADO) al panel
 * cliente, que persiste el resultado via server action.
 */
export default async function InspectorPage() {
  // Tolerante a que las tablas del CIT aun no esten migradas: la pantalla
  // siempre renderiza; la cola aparece vacia hasta que haya datos.
  const [cola, talleres, resumen] = await Promise.all([
    getColaTrabajo().catch(() => []),
    getTalleres().catch(() => []),
    getResumenHoy().catch(() => ({ total: 0, aprobados: 0, rechazados: 0 })),
  ])

  return (
    <InspectorPanel
      cola={cola}
      talleres={talleres}
      resumen={resumen}
      categorias={CATEGORIAS}
    />
  )
}
