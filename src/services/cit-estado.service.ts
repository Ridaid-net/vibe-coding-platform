import { ApiError, getPool } from '@/lib/marketplace'
import { ocultarApellido } from '@/src/services/verificador.service'

/**
 * RODAID — Estado efectivo de un CIT.
 *
 * GET /api/v1/cit/:id resuelve el estado "vivo" de un Certificado de
 * Identificación: parte del estado almacenado (`cits.estado`) y lo refina con la
 * vigencia, el puntaje de inspección y la existencia de denuncias de robo
 * activas sobre el rodado, devolviendo un estado efectivo con su etiqueta, color
 * de semáforo y las alertas/acciones sugeridas.
 *
 * Acepta tanto el UUID del CIT como su número (RCIT-2026-00041), de modo que el
 * mismo endpoint sirve para enlaces internos y para los QR de la bicicleta. Es
 * un endpoint público: el apellido del propietario se enmascara y el hash del
 * acta se trunca antes de exponerlos.
 *
 * El árbol de decisión está adaptado al esquema vivo del proyecto: las columnas
 * que el material de referencia asumía pero que esta base no almacena (tasa
 * pagada, token NFT acuñado) se reportan de forma honesta como integraciones
 * pendientes en lugar de inventarse.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VERIFICACION_BASE_URL = 'https://rodaid.com.ar/verificar'

export type EstadoColor = 'verde' | 'amarillo' | 'rojo' | 'azul' | 'gris'

interface CitEstadoRow {
  id: string
  numero_cit: string | null
  estado: string
  fecha_vencimiento: string
  fecha_emision: string | null
  puntos: number | null
  hash_sha256: string | null
  bicicleta_id: string
  marca: string
  modelo: string
  anio: number | null
  tipo: string | null
  numero_serie: string
  propietario_nombre: string | null
  inspector_nombre: string | null
  taller_nombre: string | null
}

const CIT_SELECT = `
  SELECT c.id,
         c.numero_cit,
         c.estado,
         c.fecha_vencimiento,
         c.fecha_emision,
         c.puntos,
         c.hash_sha256,
         b.id AS bicicleta_id,
         b.marca, b.modelo, b.anio, b.tipo, b.numero_serie,
         pu.nombre AS propietario_nombre,
         iu.nombre AS inspector_nombre,
         ta.nombre AS taller_nombre
    FROM cits c
    JOIN bicicletas b             ON b.id = c.bicicleta_id
    LEFT JOIN usuarios pu         ON pu.id = b.propietario_id
    LEFT JOIN inspectores i       ON i.id = c.inspector_id
    LEFT JOIN usuarios iu         ON iu.id = i.usuario_id
    LEFT JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
`

const PUNTOS_MAXIMO = 20
const PUNTOS_MINIMO = 16

export interface Alerta {
  tipo: string
  detalle: string
  accion: string | null
}

export interface CitEstado {
  id: string
  numeroCIT: string | null
  estadoBase: string
  estadoEfectivo: string
  estadoLabel: string
  estadoColor: EstadoColor
  vigente: boolean
  bicicleta: {
    marca: string
    modelo: string
    anio: number | null
    tipo: string | null
    numeroSerie: string
  }
  propietario: { nombre: string | null }
  inspector: { nombre: string | null; taller: string | null } | null
  inspeccion: { puntosTotal: number | null; maximo: number; aprobada: boolean }
  fechas: {
    emision: string | null
    vencimiento: string
    diasVigencia: number
  }
  blockchain: { hashSHA256: string | null; nftMinted: false }
  alertas: Alerta[]
  verificacionPublica: { url: string }
}

/** Trunca un hash de acta para exposición pública: "0xabcdef…" → "abcdef…". */
function hashTruncado(hash: string | null): string | null {
  if (!hash) {
    return null
  }
  const limpio = hash.replace(/^0x/i, '')
  return limpio.length > 14 ? `${limpio.slice(0, 14)}…` : limpio
}

interface ResolucionEstado {
  efectivo: string
  label: string
  color: EstadoColor
  vigente: boolean
}

/**
 * Árbol de decisión del estado efectivo, adaptado a las columnas reales de
 * `cits` (sin `tasa_pagada` ni `nft_token_id`, que no existen en este esquema).
 */
function resolverEstado(
  estadoBase: string,
  vencimientoISO: string,
  puntos: number | null,
  diasVigencia: number,
  denunciaActiva: boolean
): ResolucionEstado {
  const vencido = new Date(vencimientoISO).getTime() <= Date.now()

  switch (estadoBase) {
    case 'ACTIVO':
      if (denunciaActiva) {
        return { efectivo: 'BLOQUEADO', label: 'Bloqueado — denuncia de robo activa', color: 'rojo', vigente: false }
      }
      if (vencido) {
        return { efectivo: 'EXPIRADO', label: 'Expirado — renovación requerida', color: 'rojo', vigente: false }
      }
      if (diasVigencia < 60) {
        return { efectivo: 'VENCE_PRONTO', label: `Vigente — vence en ${diasVigencia} días`, color: 'amarillo', vigente: true }
      }
      return { efectivo: 'VIGENTE', label: 'Activo y vigente', color: 'verde', vigente: true }

    case 'BORRADOR':
      if ((puntos ?? 0) < PUNTOS_MINIMO) {
        return { efectivo: 'INSPECCION_INCOMPLETA', label: `Inspección incompleta (${puntos ?? 0}/${PUNTOS_MAXIMO})`, color: 'gris', vigente: false }
      }
      return { efectivo: 'LISTO_PARA_PAGO', label: 'Listo para pago de tasa', color: 'amarillo', vigente: false }

    case 'PAGO_PENDIENTE':
      return { efectivo: 'PAGO_PENDIENTE', label: 'Pago de tasa pendiente', color: 'amarillo', vigente: false }
    case 'PENDIENTE':
      return { efectivo: 'PENDIENTE', label: 'En validación', color: 'amarillo', vigente: false }
    case 'RECHAZADO':
      return { efectivo: 'RECHAZADO', label: 'Rechazado', color: 'rojo', vigente: false }
    case 'REVOCADO':
      return { efectivo: 'REVOCADO', label: 'Revocado', color: 'rojo', vigente: false }
    default:
      return { efectivo: estadoBase, label: `Estado ${estadoBase}`, color: 'gris', vigente: false }
  }
}

function construirAlertas(
  resolucion: ResolucionEstado,
  diasVigencia: number,
  hash: string | null
): Alerta[] {
  const alertas: Alerta[] = []

  if (resolucion.efectivo === 'BLOQUEADO') {
    alertas.push({ tipo: 'DENUNCIA_ROBO', detalle: 'Existe una denuncia de robo activa para este rodado.', accion: null })
  }
  if (resolucion.efectivo === 'EXPIRADO') {
    alertas.push({ tipo: 'CIT_EXPIRADO', detalle: 'El certificado venció y debe renovarse.', accion: 'POST /api/v1/cit/iniciar' })
  }
  if (resolucion.efectivo === 'VENCE_PRONTO') {
    alertas.push({ tipo: 'VENCE_PRONTO', detalle: `El certificado vence en ${diasVigencia} días.`, accion: null })
  }
  if (resolucion.efectivo === 'INSPECCION_INCOMPLETA') {
    alertas.push({ tipo: 'INSPECCION_INCOMPLETA', detalle: `Faltan puntos de inspección para alcanzar el mínimo de ${PUNTOS_MINIMO}/${PUNTOS_MAXIMO}.`, accion: null })
  }
  // El acuñado de NFT en Blockchain Federal Argentina es una integración aún no
  // disponible: se informa como pendiente en lugar de afirmar un token inexistente.
  if (resolucion.vigente && hash) {
    alertas.push({ tipo: 'NFT_PENDIENTE', detalle: 'Acuñado del NFT en BFA pendiente (integración no disponible).', accion: null })
  }

  return alertas
}

async function denunciaActivaPorSerie(serial: string): Promise<boolean> {
  const pool = getPool()
  const { rows } = await pool.query<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM denuncias_robo
        WHERE numero_serie = $1 AND estado = 'ACTIVA'
     ) AS existe`,
    [serial]
  )
  return rows[0]?.existe === true
}

function ensamblar(row: CitEstadoRow, denunciaActiva: boolean): CitEstado {
  const diasVigencia = Math.ceil(
    (new Date(row.fecha_vencimiento).getTime() - Date.now()) / 86_400_000
  )
  const resolucion = resolverEstado(
    row.estado,
    row.fecha_vencimiento,
    row.puntos,
    diasVigencia,
    denunciaActiva
  )

  return {
    id: row.id,
    numeroCIT: row.numero_cit,
    estadoBase: row.estado,
    estadoEfectivo: resolucion.efectivo,
    estadoLabel: resolucion.label,
    estadoColor: resolucion.color,
    vigente: resolucion.vigente,
    bicicleta: {
      marca: row.marca,
      modelo: row.modelo,
      anio: row.anio,
      tipo: row.tipo,
      numeroSerie: row.numero_serie,
    },
    propietario: { nombre: ocultarApellido(row.propietario_nombre) },
    inspector: row.inspector_nombre
      ? { nombre: ocultarApellido(row.inspector_nombre), taller: row.taller_nombre }
      : null,
    inspeccion: {
      puntosTotal: row.puntos,
      maximo: PUNTOS_MAXIMO,
      aprobada: (row.puntos ?? 0) >= PUNTOS_MINIMO,
    },
    fechas: {
      emision: row.fecha_emision,
      vencimiento: row.fecha_vencimiento,
      diasVigencia,
    },
    blockchain: { hashSHA256: hashTruncado(row.hash_sha256), nftMinted: false },
    alertas: construirAlertas(resolucion, diasVigencia, row.hash_sha256),
    verificacionPublica: {
      url: `${VERIFICACION_BASE_URL}/${encodeURIComponent(row.numero_cit ?? row.numero_serie)}`,
    },
  }
}

/** Resuelve el estado efectivo de un CIT por su UUID o por su número. */
export async function estadoCIT(idOrNumero: string): Promise<CitEstado> {
  const clave = idOrNumero?.trim() ?? ''
  if (clave.length === 0) {
    throw new ApiError(400, 'CIT_REQUERIDO', 'Debe indicar el id o número de CIT.')
  }

  const pool = getPool()
  const filtro = UUID_RE.test(clave) ? 'c.id = $1' : 'c.numero_cit = $1'
  const { rows } = await pool.query<CitEstadoRow>(
    `${CIT_SELECT} WHERE ${filtro} LIMIT 1`,
    [clave]
  )
  const row = rows[0]
  if (!row) {
    throw new ApiError(404, 'CIT_NO_ENCONTRADO', `No se encontró el CIT ${clave}.`)
  }

  const denuncia = await denunciaActivaPorSerie(row.numero_serie)
  return ensamblar(row, denuncia)
}
