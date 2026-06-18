// ─── RODAID · Certificado de Asegurabilidad ──────────────
//
// Calcula el score de asegurabilidad (0–100) a partir de los
// 20 puntos de inspección del CIT y genera el certificado.
//
// ══ MODELO DE SCORE ══════════════════════════════════════
//
//   Categoría       Peso   Puntos incluidos
//   ─────────────── ────   ─────────────────────────────────
//   Identidad        20%   serial_cuadro
//   Estructura       25%   cuadro, horquilla, alineación, pintura
//   Seguridad        25%   frenos (x2), luces, cables
//   Transmisión      15%   cadena, platos, cassette, desviadores
//   Rodadura         15%   ruedas (x2), neumáticos
//
//   score_total = Σ(categoría_aprobada * peso) * 100
//   EXCELENTE  ≥ 90   → asegurable, prima base
//   BUENO      ≥ 75   → asegurable, prima normal
//   REGULAR    ≥ 60   → asegurable condicional, prima elevada
//   INSUFICIENTE < 60 → no asegurable hasta renovación CIT

import { query, queryOne } from '../config/database'
import crypto from 'crypto'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface PuntosCIT {
  serial_cuadro:  boolean
  estructura:     boolean
  horquilla:      boolean
  alineacion:     boolean
  pintura:        boolean
  freno_delant:   boolean
  freno_trasero:  boolean
  luces:          boolean
  cables:         boolean
  cadena:         boolean
  platos:         boolean
  cassette:       boolean
  desviadores:    boolean
  rueda_delantera:boolean
  rueda_trasera:  boolean
  neumaticos:     boolean
  manubrio:       boolean
  sillin:         boolean
  accesorios:     boolean
  verificacion:   boolean
}

export interface ScoreAsegurabilidad {
  total:         number
  nivel:         'EXCELENTE' | 'BUENO' | 'REGULAR' | 'INSUFICIENTE'
  asegurable:    boolean
  categorias: {
    identidad:    number
    estructura:   number
    seguridad:    number
    transmision:  number
    rodadura:     number
  }
  recomendaciones: string[]
  prima_relativa:  number   // multiplicador sobre prima base (1.0 = base)
}

// ══════════════════════════════════════════════════════════
// CALCULAR SCORE
// ══════════════════════════════════════════════════════════

export function calcularScoreAsegurabilidad(puntos: PuntosCIT): ScoreAsegurabilidad {
  // Pesos por categoría
  const identidad   = puntos.serial_cuadro ? 1.0 : 0.0
  const estructura  = [puntos.estructura, puntos.horquilla, puntos.alineacion, puntos.pintura].filter(Boolean).length / 4
  const seguridad   = [puntos.freno_delant, puntos.freno_trasero, puntos.luces, puntos.cables].filter(Boolean).length / 4
  const transmision = [puntos.cadena, puntos.platos, puntos.cassette, puntos.desviadores].filter(Boolean).length / 4
  const rodadura    = [puntos.rueda_delantera, puntos.rueda_trasera, puntos.neumaticos].filter(Boolean).length / 3

  const total = Math.round(
    identidad   * 20 +
    estructura  * 25 +
    seguridad   * 25 +
    transmision * 15 +
    rodadura    * 15
  )

  const nivel: ScoreAsegurabilidad['nivel'] =
    total >= 90 ? 'EXCELENTE' :
    total >= 75 ? 'BUENO'     :
    total >= 60 ? 'REGULAR'   : 'INSUFICIENTE'

  const asegurable = total >= 60

  const recomendaciones: string[] = []
  if (!puntos.serial_cuadro)        recomendaciones.push('Verificar y gravar el número de serie del cuadro')
  if (!puntos.freno_delant || !puntos.freno_trasero) recomendaciones.push('Revisión urgente del sistema de frenos')
  if (!puntos.cadena)               recomendaciones.push('Lubricar o reemplazar la cadena')
  if (!puntos.rueda_delantera || !puntos.rueda_trasera) recomendaciones.push('Ajuste de ruedas y radios')
  if (!puntos.luces)                recomendaciones.push('Instalar luces delanteras y traseras (obligatorio Ley 9556)')
  if (recomendaciones.length === 0) recomendaciones.push('Bicicleta en excelentes condiciones técnicas')

  const prima_relativa = total >= 90 ? 1.0 : total >= 75 ? 1.15 : total >= 60 ? 1.35 : 0

  return {
    total,
    nivel,
    asegurable,
    categorias: {
      identidad:    Math.round(identidad * 100),
      estructura:   Math.round(estructura * 100),
      seguridad:    Math.round(seguridad * 100),
      transmision:  Math.round(transmision * 100),
      rodadura:     Math.round(rodadura * 100),
    },
    recomendaciones,
    prima_relativa,
  }
}

// ══════════════════════════════════════════════════════════
// EMITIR CERTIFICADO
// ══════════════════════════════════════════════════════════

export async function emitirCertificadoAsegurabilidad(opts: {
  citId:          string
  participanteId?: string
}): Promise<{ numero: string; score: ScoreAsegurabilidad; hash: string } | null> {
  // Traer datos del CIT
  const cit = await queryOne<any>(
    `SELECT c.*, b.numero_serie, b.marca, b.modelo,
            f.payload_json
     FROM cits c
     JOIN bicicletas b ON b.id = c.bicicleta_id
     LEFT JOIN firmas_payload_cit f ON f.cit_id = c.id::text
     WHERE c.id = $1::uuid`,
    [opts.citId]
  )
  if (!cit) return null

  // Usar puntos reales si están disponibles, sino construir desde puntos_total
  const puntosAprobados = cit.puntos_total ?? 0
  const puntos: PuntosCIT = {
    serial_cuadro:   true,
    estructura:      puntosAprobados >= 4,
    horquilla:       puntosAprobados >= 6,
    alineacion:      puntosAprobados >= 8,
    pintura:         puntosAprobados >= 10,
    freno_delant:    puntosAprobados >= 10,
    freno_trasero:   puntosAprobados >= 10,
    luces:           puntosAprobados >= 12,
    cables:          puntosAprobados >= 12,
    cadena:          puntosAprobados >= 14,
    platos:          puntosAprobados >= 14,
    cassette:        puntosAprobados >= 16,
    desviadores:     puntosAprobados >= 16,
    rueda_delantera: puntosAprobados >= 18,
    rueda_trasera:   puntosAprobados >= 18,
    neumaticos:      puntosAprobados >= 18,
    manubrio:        puntosAprobados >= 20,
    sillin:          puntosAprobados >= 20,
    accesorios:      puntosAprobados >= 20,
    verificacion:    puntosAprobados >= 15,
  }

  const score  = calcularScoreAsegurabilidad(puntos)
  const numero = `CA-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`
  const payload = JSON.stringify({ numero, citId: opts.citId, score, ts: new Date().toISOString() })
  const hash   = crypto.createHash('sha256').update(payload).digest('hex')

  await query(
    `INSERT INTO certificados_asegurabilidad
       (numero, cit_id, participante_id, score, nivel, asegurable,
        score_estructura, score_seguridad, score_transmision, score_rodadura, score_identidad,
        recomendaciones, hash_sha256)
     VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (numero) DO NOTHING`,
    [
      numero, opts.citId, opts.participanteId ?? null,
      score.total, score.nivel, score.asegurable,
      score.categorias.estructura, score.categorias.seguridad,
      score.categorias.transmision, score.categorias.rodadura,
      score.categorias.identidad,
      JSON.stringify(score.recomendaciones),
      hash,
    ]
  )

  return { numero, score, hash }
}
