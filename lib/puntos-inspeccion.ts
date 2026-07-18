/**
 * RODAID · 20 Puntos de Inspección del CIT
 * Ley Provincial N° 9.556 · Hito 11
 */
export interface PuntoInspeccion {
  id: string
  categoria: string
  descripcion: string
  critico: boolean // Si falla → DISCREPANCIA automática
}

export const PUNTOS_INSPECCION: PuntoInspeccion[] = [
  // IDENTIFICACIÓN
  { id: 'P01', categoria: 'Identificación', descripcion: 'Número de serie visible y legible en el cuadro', critico: true },
  { id: 'P02', categoria: 'Identificación', descripcion: 'Número de serie coincide con el registrado en RODAID', critico: true },
  { id: 'P03', categoria: 'Identificación', descripcion: 'Marca y modelo coinciden con la declaración', critico: true },
  { id: 'P04', categoria: 'Identificación', descripcion: 'Color del cuadro coincide con la declaración', critico: false },
  // CUADRO Y HORQUILLA
  { id: 'P05', categoria: 'Cuadro y Horquilla', descripcion: 'Cuadro sin fisuras, dobleces ni soldaduras sospechosas', critico: true },
  { id: 'P06', categoria: 'Cuadro y Horquilla', descripcion: 'Horquilla delantera en buen estado (sin torsión ni golpes)', critico: true },
  { id: 'P07', categoria: 'Cuadro y Horquilla', descripcion: 'Dirección funciona correctamente sin juego excesivo', critico: false },
  // RUEDAS Y NEUMÁTICOS
  { id: 'P08', categoria: 'Ruedas y Neumáticos', descripcion: 'Llanta delantera sin deformaciones, rayos completos y tensados', critico: false },
  { id: 'P09', categoria: 'Ruedas y Neumáticos', descripcion: 'Llanta trasera sin deformaciones, rayos completos y tensados', critico: false },
  { id: 'P10', categoria: 'Ruedas y Neumáticos', descripcion: 'Neumáticos con profundidad de banda suficiente y sin cortes', critico: false },
  // FRENOS
  { id: 'P11', categoria: 'Frenos', descripcion: 'Freno delantero funciona correctamente (palanca, cable/hidráulico, pastilla)', critico: true },
  { id: 'P12', categoria: 'Frenos', descripcion: 'Freno trasero funciona correctamente (palanca, cable/hidráulico, pastilla)', critico: true },
  // TRANSMISIÓN
  { id: 'P13', categoria: 'Transmisión', descripcion: 'Cadena en buen estado (sin eslabones rotos ni elongación excesiva)', critico: false },
  { id: 'P14', categoria: 'Transmisión', descripcion: 'Cambios funcionan correctamente (si aplica)', critico: false },
  { id: 'P15', categoria: 'Transmisión', descripcion: 'Pedalier sin juego lateral excesivo', critico: false },
  // COMPONENTES
  { id: 'P16', categoria: 'Componentes', descripcion: 'Manubrio y potencia correctamente ajustados y alineados', critico: false },
  { id: 'P17', categoria: 'Componentes', descripcion: 'Sillín y tija correctamente ajustados', critico: false },
  { id: 'P18', categoria: 'Componentes', descripcion: 'Pedales completos y funcionales', critico: false },
  // SEGURIDAD
  { id: 'P19', categoria: 'Seguridad', descripcion: 'Bicicleta no figura en lista de denuncias activas en RODAID', critico: true },
  { id: 'P20', categoria: 'Seguridad', descripcion: 'Inspector confirma identidad del propietario o portador', critico: true },
]

export type ResultadoPunto = 'ok' | 'observacion' | 'falla' | 'no_aplica'

/**
 * Puntos de "alto valor" candidatos a captura de componente (marca/modelo/
 * numero de serie) -- "CIT Completo Plus". Auditoria 2026-07-17: de los 20,
 * solo estos 5 corresponden a una pieza fisica reemplazable e identificable
 * por serial (horquilla, ruedas, frenos). El resto son verificaciones
 * estructurales/de identidad sin un componente propio -- forzarles captura
 * de marca/modelo/serial pediria datos que la pieza no tiene grabados.
 * P13/P14 (Transmision) quedan deliberadamente afuera de esta fase: zona
 * gris para una fase futura (ver CLAUDE.md).
 */
export const PUNTOS_CON_COMPONENTE = ['P06', 'P08', 'P09', 'P11', 'P12'] as const
export type PuntoConComponente = (typeof PUNTOS_CON_COMPONENTE)[number]

export function esPuntoConComponente(puntoId: string): puntoId is PuntoConComponente {
  return (PUNTOS_CON_COMPONENTE as readonly string[]).includes(puntoId)
}

/**
 * Datos del componente fisico capturados en un punto de alto valor. La foto
 * NO viaja acá -- se sube aparte (multipart) y el backend la asocia por
 * puntoId; este objeto solo lleva los campos de texto.
 */
export interface ComponenteCapturado {
  marca?: string
  modelo?: string
  numeroSerie?: string
  /** Solo PR07 (motor) y PR08 (batería) lo usan hoy -- ver PUNTOS_INSPECCION_PREMIUM. */
  especificaciones?: Record<string, number>
}

/**
 * Checklist Premium — suspensión trasera, suspensión delantera con bloqueo,
 * tija telescópica, cambios/shifters electrónicos, pata de cambio, motor y
 * batería de e-bike. Estándar propio de RODAID (confirmado por Federico
 * 2026-07-18: la Ley 9.556 no exige los 20 puntos base, son un piso propio
 * de RODAID -- sin restricción normativa para este módulo adicional),
 * deliberadamente SEPARADO de PUNTOS_INSPECCION por prolijidad de producto
 * -- calcularResultadoChecklist() NUNCA itera esta lista: el módulo premium
 * no gatea la aprobación/discrepancia del CIT, es puramente informativo /
 * antifraude / de valor de reventa (por eso los 8 son `critico: false`).
 *
 * IDs con prefijo "PR" (no continúan la numeración P21..) a propósito, para
 * que nunca se confundan con los 20 puntos base en una fila de datos.
 */
export const PUNTOS_INSPECCION_PREMIUM: PuntoInspeccion[] = [
  { id: 'PR01', categoria: 'Suspensión', descripcion: 'Suspensión trasera (Fox u otras)', critico: false },
  { id: 'PR02', categoria: 'Suspensión', descripcion: 'Suspensión delantera con bloqueo', critico: false },
  { id: 'PR03', categoria: 'Componentes Electrónicos', descripcion: 'Tija telescópica (hidráulica o eléctrica)', critico: false },
  { id: 'PR04', categoria: 'Componentes Electrónicos', descripcion: 'Cambios electrónicos (Sram/Shimano)', critico: false },
  { id: 'PR05', categoria: 'Componentes Electrónicos', descripcion: 'Shifters electrónicos', critico: false },
  { id: 'PR06', categoria: 'Componentes Electrónicos', descripcion: 'Pata de cambio (electrónica o mecánica)', critico: false },
  { id: 'PR07', categoria: 'Sistema Eléctrico (E-bike)', descripcion: 'Motor de e-bike', critico: false },
  { id: 'PR08', categoria: 'Sistema Eléctrico (E-bike)', descripcion: 'Batería de e-bike', critico: false },
]

/** Los 8 puntos premium SIEMPRE capturan componente -- a diferencia de los
 * 20 base, donde solo 5-de-20 son candidatos (ver PUNTOS_CON_COMPONENTE). */
export const PUNTOS_PREMIUM_CON_COMPONENTE = [
  'PR01', 'PR02', 'PR03', 'PR04', 'PR05', 'PR06', 'PR07', 'PR08',
] as const
export type PuntoPremiumConComponente = (typeof PUNTOS_PREMIUM_CON_COMPONENTE)[number]

/**
 * Filtro de aplicabilidad -- coarse, no una matriz fina por tipo de bici.
 * Solo PR01 (suspensión trasera) y PR07/PR08 (motor/batería) tienen un
 * atributo de la bici que realmente los determina; PR02-PR06 son
 * transversales a varias disciplinas (ej. cambios electrónicos existen en
 * Ruta, Gravel y MTB por igual) -- forzar una matriz de compatibilidad por
 * tipo inventaría precisión que no existe. Para esos, el filtro real es el
 * mismo patrón ya usado por P14 ("si aplica"): el inspector los ve todos
 * cuando activa el módulo premium, y marca 'no_aplica' el que no corresponda.
 */
export function puntosPremiumAplicables(bici: {
  tipo: string
  suspensionTrasera: boolean | null
}): PuntoInspeccion[] {
  return PUNTOS_INSPECCION_PREMIUM.filter((p) => {
    if (p.id === 'PR01') return bici.suspensionTrasera === true
    if (p.id === 'PR07' || p.id === 'PR08') return bici.tipo === 'Eléctrica'
    return true
  })
}

export interface ChecklistInspeccion {
  [puntoId: string]: {
    resultado: ResultadoPunto
    nota?: string
    /** Solo presente si puntoId ∈ PUNTOS_CON_COMPONENTE. */
    componente?: ComponenteCapturado
  }
}

export function calcularResultadoChecklist(checklist: ChecklistInspeccion): {
  aprobada: boolean
  puntosOk: number
  puntosObservacion: number
  puntosFalla: number
  puntosCriticosFailados: string[]
} {
  const puntosCriticosFailados: string[] = []
  let puntosOk = 0
  let puntosObservacion = 0
  let puntosFalla = 0

  for (const punto of PUNTOS_INSPECCION) {
    const r = checklist[punto.id]?.resultado ?? 'no_aplica'
    if (r === 'ok') puntosOk++
    else if (r === 'observacion') puntosObservacion++
    else if (r === 'falla') {
      puntosFalla++
      if (punto.critico) puntosCriticosFailados.push(punto.id)
    }
  }

  return {
    aprobada: puntosCriticosFailados.length === 0 && puntosFalla === 0,
    puntosOk,
    puntosObservacion,
    puntosFalla,
    puntosCriticosFailados,
  }
}
