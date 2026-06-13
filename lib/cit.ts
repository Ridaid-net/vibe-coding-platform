// RODAID — Modulo Inspector (CIT)
//
// Catalogo de los 20 puntos de control de la inspeccion tecnica y la regla que
// gatilla el evento "CIT Aprobado" o "Rechazado". Esta es la unica fuente de
// verdad de los 20 puntos: la usan la pantalla del inspector, el server action
// y el servicio que persiste el resultado.
//
// Regla legal: Ley Provincial 9556 (Mendoza), Art. 12 -> minimo 15/20 puntos.

export const PUNTOS_MINIMOS = 15

/** Categorias de la inspeccion y su peso relativo en el score de aseguramiento. */
export interface CategoriaCIT {
  id: 'identidad' | 'estructura' | 'seguridad' | 'transmision' | 'rodadura'
  label: string
  /** Peso porcentual de la categoria en el score (suman 100). */
  peso: number
  /** Color de acento de la categoria (paleta RODAID). */
  color: string
  puntos: PuntoControl[]
}

export interface PuntoControl {
  /** Clave estable persistida en cit_puntos_control.codigo. */
  key: string
  label: string
  /** Criterio tecnico que el inspector debe verificar. */
  desc: string
  /** Punto critico de seguridad/identidad. Su falla se resalta en el resultado. */
  critico?: boolean
}

export const CATEGORIAS: CategoriaCIT[] = [
  {
    id: 'identidad',
    label: 'Identidad del rodado',
    peso: 20,
    color: '#2BBCB8',
    puntos: [
      {
        key: 'serial',
        label: 'Numero de serie',
        critico: true,
        desc: 'Numero de serie visible en el tubo del cuadro, coincide con el registrado en el sistema. Se verifica con lupa y luz si es necesario.',
      },
    ],
  },
  {
    id: 'estructura',
    label: 'Estructura',
    peso: 25,
    color: '#3B82F6',
    puntos: [
      {
        key: 'cuadro',
        label: 'Cuadro',
        critico: true,
        desc: 'Sin fisuras, abolladuras profundas ni soldaduras irregulares. Inspeccionar uniones y tubo inferior visualmente y con pasada de manos.',
      },
      {
        key: 'horquilla',
        label: 'Horquilla',
        critico: true,
        desc: 'Sin deformaciones, juego lateral ni fisuras. Comprobar alineacion con respecto al cuadro.',
      },
      {
        key: 'manubrio',
        label: 'Manubrio y potencia',
        desc: 'Manubrio centrado, sin fisuras. Potencia correctamente apretada. Punos en buen estado.',
      },
      {
        key: 'asiento',
        label: 'Asiento y tija',
        desc: 'Sillin sin roturas. Tija correctamente ajustada dentro del rango de seguridad minimo.',
      },
    ],
  },
  {
    id: 'seguridad',
    label: 'Seguridad activa',
    peso: 25,
    color: '#F47B20',
    puntos: [
      {
        key: 'freno_delantero',
        label: 'Freno delantero',
        critico: true,
        desc: 'Zapatas en buen estado. Cable sin deshilachado. Carrera de palanca adecuada. Potencia de frenado efectiva.',
      },
      {
        key: 'freno_trasero',
        label: 'Freno trasero',
        critico: true,
        desc: 'Mismo criterio que freno delantero. Verificar que el bloque de freno toque el aro en paralelo.',
      },
      {
        key: 'cables',
        label: 'Cables y fundas',
        desc: 'Cables de freno y cambio sin corrosion ni deshilachado. Fundas integras. Extremos con protector.',
      },
      {
        key: 'luces',
        label: 'Luces (si aplica)',
        desc: 'Luz delantera y trasera funcionales (Ley 9556 art. 14). Para uso diurno exclusivo se anota en observaciones.',
      },
      {
        key: 'accesorios',
        label: 'Accesorios reglamentarios',
        desc: 'Reflectivo trasero. Timbre/bocina funcional. Espejo (si aplica norma municipal).',
      },
    ],
  },
  {
    id: 'transmision',
    label: 'Transmision',
    peso: 15,
    color: '#8B5CF6',
    puntos: [
      {
        key: 'cambio_delantero',
        label: 'Cambio delantero',
        desc: 'Desviador alineado. Cambio fluido entre platos. En monoplato se anota en observaciones.',
      },
      {
        key: 'cambio_trasero',
        label: 'Cambio trasero',
        desc: 'Desviador sin roturas. Cambio preciso en todos los pinones. Tensor calibrado.',
      },
      {
        key: 'cassette',
        label: 'Cassette / pinones',
        desc: 'Sin dientes desgastados en punta. Sin saltos de cadena en prueba funcional.',
      },
      {
        key: 'cadena',
        label: 'Cadena',
        desc: 'Sin estiramiento excesivo (verificar con medidor de cadena o regla). Lubricada.',
      },
      {
        key: 'bielas',
        label: 'Bielas y pedalier',
        desc: 'Sin juego lateral. Pedalier gira suavemente sin ruidos. Bielas simetricas y apretadas.',
      },
    ],
  },
  {
    id: 'rodadura',
    label: 'Rodadura',
    peso: 15,
    color: '#10B981',
    puntos: [
      {
        key: 'pedales',
        label: 'Pedales',
        desc: 'Pedales bien roscados. Superficie antideslizante integra. Sin juego excesivo en el eje.',
      },
      {
        key: 'rueda_delantera',
        label: 'Rueda delantera',
        desc: 'Centrada (max. 2mm de wobble). Sin radios rotos. Aro sin abolladuras. Buje sin juego.',
      },
      {
        key: 'rueda_trasera',
        label: 'Rueda trasera',
        desc: 'Mismo criterio que rueda delantera.',
      },
      {
        key: 'cubiertas',
        label: 'Cubiertas y camaras',
        desc: 'Sin cortes profundos ni lonas expuestas. Camara inflada a presion adecuada (indicada en el flanco).',
      },
      {
        key: 'prueba_funcional',
        label: 'Prueba funcional completa',
        critico: true,
        desc: 'Rodada en pista (minimo 50m). Verifica funcionamiento real: frenada, cambios, ruidos, direccion.',
      },
    ],
  },
]

/** Lista plana de los 20 puntos, en orden de inspeccion. */
export const PUNTOS_PLANOS: Array<PuntoControl & { categoria: CategoriaCIT['id']; peso: number; orden: number }> =
  CATEGORIAS.flatMap((cat) =>
    cat.puntos.map((p, i) => ({
      ...p,
      categoria: cat.id,
      // peso individual = peso de la categoria repartido entre sus puntos
      peso: Math.round((cat.peso / cat.puntos.length) * 100) / 100,
      orden: i,
    }))
  )

export const PUNTOS_KEYS = PUNTOS_PLANOS.map((p) => p.key)

/** Mapa de resultados booleanos por punto (true = aprobado). */
export type ResultadosPuntos = Record<string, boolean>

export interface ResultadoEvaluacion {
  /** Cantidad de puntos aprobados (0..20). */
  puntos: number
  /** Score de aseguramiento ponderado por categoria (0..100). */
  puntaje: number
  /** true si alcanza el minimo legal de 15/20. */
  aprobado: boolean
  /** Codigos de puntos criticos no aprobados. */
  criticosFallidos: string[]
  /** Detalle por categoria: aprobados / total. */
  porCategoria: Array<{ id: CategoriaCIT['id']; label: string; aprobados: number; total: number; color: string }>
  /** Motivo legible cuando no se aprueba. */
  motivoRechazo: string | null
}

/**
 * Evalua una inspeccion: cuenta los puntos aprobados, calcula el score ponderado
 * y resuelve si el CIT se APRUEBA (>= 15/20) o se RECHAZA. Es la funcion que
 * "gatilla" el evento; tanto la UI (en vivo) como el servidor la usan.
 */
export function evaluarInspeccion(resultados: ResultadosPuntos): ResultadoEvaluacion {
  let puntaje = 0
  const porCategoria = CATEGORIAS.map((cat) => {
    const aprobados = cat.puntos.filter((p) => resultados[p.key] === true).length
    puntaje += (aprobados / cat.puntos.length) * cat.peso
    return {
      id: cat.id,
      label: cat.label,
      aprobados,
      total: cat.puntos.length,
      color: cat.color,
    }
  })

  const puntos = PUNTOS_PLANOS.filter((p) => resultados[p.key] === true).length
  const criticosFallidos = PUNTOS_PLANOS.filter(
    (p) => p.critico && resultados[p.key] !== true
  ).map((p) => p.key)

  const aprobado = puntos >= PUNTOS_MINIMOS

  let motivoRechazo: string | null = null
  if (!aprobado) {
    motivoRechazo = `Puntos insuficientes: ${puntos}/20 (minimo legal ${PUNTOS_MINIMOS}, Ley 9556 Art. 12).`
  }

  return {
    puntos,
    puntaje: Math.round(puntaje),
    aprobado,
    criticosFallidos,
    porCategoria,
    motivoRechazo,
  }
}

/** Etiqueta de un punto por su codigo. */
export function etiquetaPunto(key: string): string {
  return PUNTOS_PLANOS.find((p) => p.key === key)?.label ?? key
}
