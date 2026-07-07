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

export interface ChecklistInspeccion {
  [puntoId: string]: {
    resultado: ResultadoPunto
    nota?: string
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
