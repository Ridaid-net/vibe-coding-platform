// ─── RODAID · Marketplace Service ─────────────────────────
// CRUD de publicaciones de bicicletas certificadas.
// Tabla: marketplace_publicaciones
//
// Reglas:
//   · Solo bicicletas con CIT ACTIVO y vigente
//   · Vendedor debe ser el propietario del CIT
//   · Sin publicaciones duplicadas por CIT
//   · Slug único generado automáticamente
//   · Comisión: 2.5% Plan Libre · 1.8% Estándar · 1.2% Premium

import crypto from 'crypto'
import { query, queryOne } from '../config/database'
import { getRedis }         from '../config/redis'
import { log }              from '../middleware/logger'
import { AppError }         from '../middleware/errorHandler'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface FiltrosMarketplace {
  estado?:    string
  marcas?:    string[]
  tipo?:      string
  precioMin?: number
  precioMax?: number
  orden?:     'precio_asc' | 'precio_desc' | 'recientes' | 'vistas'
  pagina?:    number
  limite?:    number
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function generarSlug(marca: string, modelo: string, anio: number): string {
  const base = `${marca}-${modelo}-${anio}`
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base}-${crypto.randomBytes(3).toString('hex')}`
}

function mapRow(r: any) {
  const fotos = Array.isArray(r.fotos_urls)
    ? r.fotos_urls
    : String(r.fotos_urls ?? '').replace(/[{}]/g,'').split(',').filter(Boolean)
  return {
    id:          r.id,
    slug:        r.slug,
    titulo:      r.titulo,
    descripcion: r.descripcion,
    precioARS:   parseFloat(r.precio_ars),
    precioUSD:   r.precio_usd ? parseFloat(r.precio_usd) : undefined,
    fotosUrls:   fotos,
    estado:      r.estado,
    vistas:      r.vistas ?? 0,
    contactos:   r.contactos ?? 0,
    publicadoEn: new Date(r.publicado_en),
    venceEn:     new Date(r.vence_en),
    destacada:   r.destacada ?? false,
    vendidoEn:   r.vendido_en ? new Date(r.vendido_en) : undefined,
    precioFinal: r.precio_final_ars ? parseFloat(r.precio_final_ars) : undefined,
    comision:    r.comision_rodaid ? parseFloat(r.comision_rodaid) : undefined,
    bicicleta: {
      serial: r.serial, marca: r.marca, modelo: r.modelo,
      anio: r.anio, tipo: r.tipo, color: r.color,
    },
    cit: {
      numeroCIT:       r.numero_cit,
      estado:          r.cit_estado,
      hashSHA256:      r.hash_sha256,
      puntos:          r.puntos,
      fechaVencimiento: r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null,
      codigoVerif:     r.codigo_verif ?? undefined,
    },
    vendedor: { id: r.vendedor_id, nombre: r.vendedor_nombre, localidad: r.localidad },
  }
}

const SELECT = `
  mp.id, mp.slug, mp.titulo, mp.descripcion,
  mp.precio_ars, mp.precio_usd, mp.fotos_urls,
  mp.estado::text, mp.vistas, mp.contactos, mp.publicado_en, mp.vence_en, mp.destacada,
  mp.vendido_en, mp.precio_final_ars, mp.comision_rodaid,
  b.numero_serie AS serial, b.marca, b.modelo, b.anio,
  b.tipo::text AS tipo, b.color,
  c.numero_cit, c.estado::text AS cit_estado,
  c.hash_sha256, c.puntos, c.fecha_vencimiento, c.codigo_verif,
  u.id AS vendedor_id, u.nombre AS vendedor_nombre, NULL::text AS localidad`

// ══════════════════════════════════════════════════════════
// PUBLICAR
// ══════════════════════════════════════════════════════════

export async function publicarBicicleta(input: {
  vendedorId: string
  citId:      string
  titulo:     string; descripcion?: string; precioARS: number
  precioUSD?: number; fotosUrls?: string[]
}) {
  // 1. Cargar CIT
  const cit = await queryOne<{
    id: string; numeroCIT: string; estado: string; hashSHA256: string
    propietarioId: string; bicicletaId: string; puntos: number
    fechaVencimiento: Date | null; codigoVerif: string | null
    marca: string; modelo: string; anio: number; tipo: string; color: string; serial: string
  }>(
    `SELECT c.id, c.numero_cit AS "numeroCIT", c.estado::text AS "estado",
            c.hash_sha256 AS "hashSHA256", c.propietario_id AS "propietarioId",
            c.bicicleta_id AS "bicicletaId", c.puntos,
            c.fecha_vencimiento AS "fechaVencimiento", c.codigo_verif AS "codigoVerif",
            b.marca, b.modelo, b.anio, b.tipo::text AS "tipo", b.color, b.numero_serie AS "serial"
     FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`,
    [input.citId]
  )

  if (!cit) throw new AppError('CIT no encontrado', 404, 'CIT_NOT_FOUND')

  // 2. Validar propietario
  if (cit.propietarioId !== input.vendedorId)
    throw new AppError('Solo el propietario registrado en el CIT puede publicar esta bicicleta', 403, 'NOT_OWNER')

  // 3. Validar estado CIT
  if (cit.estado !== 'ACTIVO')
    throw new AppError(`El CIT debe estar ACTIVO para publicarse (estado actual: ${cit.estado})`, 422, 'CIT_NOT_ACTIVE')

  if (cit.fechaVencimiento && cit.fechaVencimiento < new Date())
    throw new AppError(`El CIT venció el ${cit.fechaVencimiento.toLocaleDateString('es-AR')}. Renovalo antes de publicar.`, 422, 'CIT_EXPIRED')

  // 4. Sin duplicados
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM marketplace_publicaciones WHERE cit_id=$1 AND estado IN ('ACTIVA','PAUSADA')`, [input.citId]
  )
  if (dup) throw new AppError('Ya existe una publicación activa o pausada para esta bicicleta', 409, 'DUPLICATE_LISTING')

  // 5. Generar slug único
  let slug = generarSlug(cit.marca, cit.modelo, cit.anio)
  for (let i = 0; i < 5; i++) {
    const exists = await queryOne<{id:string}>(`SELECT id FROM marketplace_publicaciones WHERE slug=$1`, [slug])
    if (!exists) break
    slug = generarSlug(cit.marca, cit.modelo, cit.anio)
  }

  // 6. Insertar
  const descr = input.descripcion?.trim() ?? `${cit.marca} ${cit.modelo} ${cit.anio} — ${cit.tipo}`
  const fotos = input.fotosUrls?.length ? `{${input.fotosUrls.join(',')}}` : '{}'

  const row = await queryOne<{ id: string; publicado_en: Date; vence_en: Date }>(
    `INSERT INTO marketplace_publicaciones
       (cit_id, bicicleta_id, vendedor_id, titulo, descripcion,
        precio_ars, precio_usd, fotos_urls, slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, publicado_en, vence_en`,
    [input.citId, cit.bicicletaId, input.vendedorId,
     input.titulo.trim(), descr,
     input.precioARS, input.precioUSD ?? null, fotos, slug]
  )

  log.marketplace.info({ id: row?.id, slug, numeroCIT: cit.numeroCIT, precioARS: input.precioARS }, '✓ Publicación creada')

  const pub = await getPublicacion(slug)
  return pub!
}

// ══════════════════════════════════════════════════════════
// LISTAR
// ══════════════════════════════════════════════════════════

export async function listarPublicaciones(q: FiltrosMarketplace = {}) {
  const { estado='ACTIVA', marcas, tipo, precioMin, precioMax,
          orden='recientes', pagina=1, limite=12 } = q

  const key = `mp:lista:${JSON.stringify(q)}`
  try {
    const cached = await getRedis().get(key)
    if (cached) return JSON.parse(cached)
  } catch { /* continue */ }

  const offset = (pagina - 1) * Math.min(limite, 50)
  const params: unknown[] = [`${estado}`]
  const conds: string[] = ["mp.estado=$1::estado_publicacion", "mp.vence_en > NOW()"]

  if (marcas?.length) { params.push(marcas); conds.push(`b.marca = ANY($${params.length})`) }
  if (tipo)           { params.push(tipo.toUpperCase()); conds.push(`b.tipo::text=$${params.length}`) }
  if (precioMin)      { params.push(precioMin); conds.push(`mp.precio_ars>=$${params.length}`) }
  if (precioMax)      { params.push(precioMax); conds.push(`mp.precio_ars<=$${params.length}`) }

  const where = conds.join(' AND ')
  const orderBy = ({ precio_asc:'mp.precio_ars ASC', precio_desc:'mp.precio_ars DESC',
                     recientes:'mp.publicado_en DESC', vistas:'mp.vistas DESC' })[orden] ?? 'mp.publicado_en DESC'

  params.push(Math.min(limite, 50), offset)
  const lp = params.length, op = lp - 1

  const [rows, tot] = await Promise.all([
    query<any>(
      `SELECT ${SELECT} FROM marketplace_publicaciones mp
       JOIN bicicletas b ON b.id=mp.bicicleta_id
       JOIN cits c ON c.id=mp.cit_id
       JOIN usuarios u ON u.id=mp.vendedor_id
       WHERE ${where} ORDER BY mp.destacada DESC, ${orderBy}
       LIMIT $${op} OFFSET $${lp}`,
      params
    ),
    queryOne<{n:string}>(
      `SELECT COUNT(*)::text AS n FROM marketplace_publicaciones mp
       JOIN bicicletas b ON b.id=mp.bicicleta_id WHERE ${where}`,
      params.slice(0,-2)
    ),
  ])

  const total   = parseInt(tot?.n ?? '0')
  const result  = { publicaciones: rows.map(mapRow), total, pagina, paginas: Math.ceil(total/Math.min(limite,50)) }

  getRedis().set(key, JSON.stringify(result), 'EX', 60).catch(()=>{})
  return result
}

// ══════════════════════════════════════════════════════════
// DETALLE POR SLUG O ID
// ══════════════════════════════════════════════════════════

export async function getPublicacion(slugOrId: string, views = false) {
  const row = await queryOne<any>(
    `SELECT ${SELECT} FROM marketplace_publicaciones mp
     JOIN bicicletas b ON b.id=mp.bicicleta_id
     JOIN cits c ON c.id=mp.cit_id
     JOIN usuarios u ON u.id=mp.vendedor_id
     WHERE mp.slug=$1 OR (mp.id::text=$1 AND $1 ~ '^[0-9a-f-]{36}$')`,
    [slugOrId]
  )
  if (!row) return null
  if (views) query(`UPDATE marketplace_publicaciones SET vistas=vistas+1 WHERE id=$1`, [row.id]).catch(()=>{})
  return mapRow(row)
}

// ══════════════════════════════════════════════════════════
// EDITAR
// ══════════════════════════════════════════════════════════

export async function editarPublicacion(input: {
  publicacionId: string; vendedorId: string
  titulo?: string; descripcion?: string; precioARS?: number; precioUSD?: number | null; fotosUrls?: string[]
}) {
  const pub = await queryOne<{ vendedor_id:string; estado:string; precio_ars:number; slug:string }>(
    `SELECT vendedor_id, estado::text AS estado, precio_ars, slug FROM marketplace_publicaciones WHERE id=$1`,
    [input.publicacionId]
  )
  if (!pub) throw new AppError('Publicación no encontrada', 404, 'NOT_FOUND')
  if (pub.vendedor_id !== input.vendedorId) throw new AppError('Sin permiso', 403, 'FORBIDDEN')
  if (['VENDIDA','CANCELADA'].includes(pub.estado)) throw new AppError(`No se puede editar (estado: ${pub.estado})`, 422, 'INVALID_STATE')

  const sets: string[] = ['actualizado_en=NOW()']; const params: unknown[] = []
  const p = () => `$${params.length}`

  if (input.titulo)       { params.push(input.titulo.trim());  sets.push(`titulo=${p()}`) }
  if (input.descripcion)  { params.push(input.descripcion.trim()); sets.push(`descripcion=${p()}`) }
  if (input.precioARS && input.precioARS !== pub.precio_ars) {
    params.push(input.precioARS); sets.push(`precio_ars=${p()}`)
    query(`INSERT INTO marketplace_historial_precios (publicacion_id,precio_anterior,precio_nuevo) VALUES ($1,$2,$3)`,
      [input.publicacionId, pub.precio_ars, input.precioARS]).catch(()=>{})
  }
  if (input.precioUSD !== undefined) { params.push(input.precioUSD??null); sets.push(`precio_usd=${p()}`) }
  if (input.fotosUrls) { params.push(`{${input.fotosUrls.join(',')}}`); sets.push(`fotos_urls=${p()}`) }

  params.push(input.publicacionId)
  await query(`UPDATE marketplace_publicaciones SET ${sets.join(',')} WHERE id=${p()}`, params)
  getRedis().del(`mp:lista:*`).catch(()=>{})

  return getPublicacion(pub.slug)
}

// ══════════════════════════════════════════════════════════
// PAUSAR / ACTIVAR
// ══════════════════════════════════════════════════════════

export async function pausarPublicacion(id: string, vendedorId: string) {
  const pub = await queryOne<{ vendedor_id:string; estado:string }>(
    `SELECT vendedor_id, estado::text AS estado FROM marketplace_publicaciones WHERE id=$1`, [id]
  )
  if (!pub) throw new AppError('Publicación no encontrada', 404, 'NOT_FOUND')
  if (pub.vendedor_id !== vendedorId) throw new AppError('Sin permiso', 403, 'FORBIDDEN')
  if (['VENDIDA','CANCELADA'].includes(pub.estado)) throw new AppError(`No se puede cambiar el estado (${pub.estado})`, 422, 'INVALID_STATE')

  const next = pub.estado === 'ACTIVA' ? 'PAUSADA' : 'ACTIVA'
  await query(`UPDATE marketplace_publicaciones SET estado=$2::estado_publicacion, actualizado_en=NOW() WHERE id=$1`, [id, next])
  log.marketplace.info({ id, de: pub.estado, a: next }, 'Estado publicación cambiado')
  return { id, estado: next }
}

// ══════════════════════════════════════════════════════════
// MARCAR VENDIDA
// ══════════════════════════════════════════════════════════

export async function marcarVendida(id: string, vendedorId: string, precioFinalARS: number, compradorId?: string) {
  const pub = await queryOne<{ vendedor_id:string; estado:string; slug:string }>(
    `SELECT vendedor_id, estado::text AS estado, slug FROM marketplace_publicaciones WHERE id=$1`, [id]
  )
  if (!pub) throw new AppError('Publicación no encontrada', 404, 'NOT_FOUND')
  if (pub.vendedor_id !== vendedorId) throw new AppError('Sin permiso', 403, 'FORBIDDEN')
  if (!['ACTIVA','PAUSADA'].includes(pub.estado)) throw new AppError(`Estado inválido para vender: ${pub.estado}`, 422, 'INVALID_STATE')

  const comisionRodaid = Math.round(precioFinalARS * 0.025 * 100) / 100

  await query(
    `UPDATE marketplace_publicaciones
     SET estado='VENDIDA'::estado_publicacion, vendido_en=NOW(), actualizado_en=NOW(),
         precio_final_ars=$2, comprador_id=$3, comision_rodaid=$4
     WHERE id=$1`,
    [id, precioFinalARS, compradorId??null, comisionRodaid]
  )

  getRedis().del(`mp:lista:*`).catch(()=>{})
  log.marketplace.info({ id, precioFinalARS, comisionRodaid }, '✓ Publicación marcada VENDIDA')
  return { id, comisionRodaid }
}

// ══════════════════════════════════════════════════════════
// REGISTRAR CONTACTO
// ══════════════════════════════════════════════════════════

export async function registrarContacto(opts: {
  publicacionId:string; interesadoId?:string; mensaje:string; telefono?:string; email?:string
}) {
  const pub = await queryOne<{estado:string}>(
    `SELECT estado::text AS estado FROM marketplace_publicaciones WHERE id=$1`, [opts.publicacionId]
  )
  if (!pub || pub.estado !== 'ACTIVA') throw new AppError('Publicación no disponible', 422, 'NOT_AVAILABLE')

  const [row] = await Promise.all([
    queryOne<{id:string}>(
      `INSERT INTO marketplace_contactos (publicacion_id,interesado_id,mensaje,telefono,email)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [opts.publicacionId, opts.interesadoId??null, opts.mensaje, opts.telefono??null, opts.email??null]
    ),
    query(`UPDATE marketplace_publicaciones SET contactos=contactos+1 WHERE id=$1`, [opts.publicacionId]),
  ])
  return { id: row?.id ?? '' }
}

// ══════════════════════════════════════════════════════════
// MIS PUBLICACIONES
// ══════════════════════════════════════════════════════════

export async function misPublicaciones(opts: {
  vendedorId: string
  estado?:    'ACTIVA' | 'PAUSADA' | 'VENDIDA' | 'CANCELADA' | 'todas'
  pagina?:    number
  porPagina?: number
}): Promise<{
  publicaciones: PublicacionListado[]
  total:         number
  resumen:       ResumenMisPublicaciones
  pagina:        number
}> {
  const estado    = opts.estado ?? 'todas'
  const pagina    = Math.max(1, opts.pagina    ?? 1)
  const porPagina = Math.min(50, opts.porPagina ?? 25)
  const offset    = (pagina - 1) * porPagina

  const estadoFilter = estado !== 'todas'
    ? `AND mp.estado = '${estado}'`
    : ''

  const [rows, totalRow, resumenRow] = await Promise.all([
    query<any>(`
      SELECT
        mp.id::text,
        mp.titulo,
        mp.descripcion,
        mp.precio_ars,
        mp.estado,
        mp.tipo_entrega,
        mp.fotos_urls,
        mp.vistas,
        mp.contactos,
        mp.publicado_en,
        mp.actualizado_en,
        mp.vendido_en,
        mp.comprador_id::text,
        mp.precio_final_ars,
        mp.comision_rodaid,
        -- Bicicleta
        b.id::text         AS bici_id,
        b.numero_serie,
        b.marca,
        b.modelo,
        -- CIT más reciente de esta bicicleta
        c.id::text         AS cit_id,
        c.numero_cit,
        c.estado           AS cit_estado,
        c.puntos_total,
        c.hash_sha256,
        c.fecha_vencimiento::text,
        -- Propietario
        u.nombre           AS vendedor_nombre,
        u.email            AS vendedor_email
      FROM marketplace_publicaciones mp
      JOIN bicicletas b ON b.id = mp.bicicleta_id
      JOIN usuarios   u ON u.id = mp.propietario_id
      LEFT JOIN LATERAL (
        SELECT id, numero_cit, estado, puntos_total, hash_sha256, fecha_vencimiento
        FROM cits
        WHERE bicicleta_id = b.id
        ORDER BY creado_en DESC LIMIT 1
      ) c ON TRUE
      WHERE mp.propietario_id = $1
        ${estadoFilter}
      ORDER BY mp.publicado_en DESC
      LIMIT $2 OFFSET $3
    `, [opts.vendedorId, porPagina, offset]),

    queryOne<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM marketplace_publicaciones
      WHERE propietario_id = $1
        ${estadoFilter.replace('mp.estado', 'estado')}
    `, [opts.vendedorId]),

    queryOne<any>(`
      SELECT
        COUNT(*)::int                                   AS total,
        COUNT(*) FILTER(WHERE estado='ACTIVA')::int    AS activas,
        COUNT(*) FILTER(WHERE estado='PAUSADA')::int   AS pausadas,
        COUNT(*) FILTER(WHERE estado='VENDIDA')::int   AS vendidas,
        COALESCE(SUM(precio_ars) FILTER(WHERE estado='ACTIVA'),0)::numeric   AS valor_activo,
        COALESCE(SUM(precio_final_ars) FILTER(WHERE estado='VENDIDA'),0)::numeric AS cobrado,
        COALESCE(SUM(vistas),0)::int    AS total_vistas,
        COALESCE(SUM(contactos),0)::int AS total_contactos
      FROM marketplace_publicaciones
      WHERE propietario_id = $1
    `, [opts.vendedorId]),
  ])

  const publicaciones: PublicacionListado[] = rows.map(r => ({
    id:          r.id,
    titulo:      r.titulo,
    descripcion: r.descripcion ?? null,
    precioARS:   parseFloat(r.precio_ars),
    estado:      r.estado,
    tipoEntrega: r.tipo_entrega,
    fotosUrls:   r.fotos_urls ?? [],
    vistas:      r.vistas ?? 0,
    contactos:   r.contactos ?? 0,
    publicadoEn: r.publicado_en,
    actualizadoEn: r.actualizado_en,
    vendidoEn:   r.vendido_en ?? null,
    precioFinalARS: r.precio_final_ars ? parseFloat(r.precio_final_ars) : null,
    comisionRodaid: r.comision_rodaid  ? parseFloat(r.comision_rodaid)  : null,
    bicicleta: {
      id:          r.bici_id,
      numeroSerie: r.numero_serie,
      marca:       r.marca,
      modelo:      r.modelo,
    },
    cit: r.cit_id ? {
      id:               r.cit_id,
      numeroCIT:        r.numero_cit,
      estado:           r.cit_estado,
      puntosTotal:      r.puntos_total,
      hashSHA256:       r.hash_sha256 || null,
      fechaVencimiento: r.fecha_vencimiento ? r.fecha_vencimiento.slice(0, 10) : null,
      vigente:          r.cit_estado === 'ACTIVO',
    } : null,
  }))

  const resumen: ResumenMisPublicaciones = {
    total:          resumenRow?.total          ?? 0,
    activas:        resumenRow?.activas        ?? 0,
    pausadas:       resumenRow?.pausadas       ?? 0,
    vendidas:       resumenRow?.vendidas       ?? 0,
    valorActivoARS: parseFloat(resumenRow?.valor_activo ?? '0'),
    cobradoARS:     parseFloat(resumenRow?.cobrado      ?? '0'),
    totalVistas:    resumenRow?.total_vistas   ?? 0,
    totalContactos: resumenRow?.total_contactos ?? 0,
  }

  return {
    publicaciones,
    total:  parseInt(totalRow?.count ?? '0'),
    resumen,
    pagina,
  }
}

export interface PublicacionListado {
  id:           string
  titulo:       string
  descripcion:  string | null
  precioARS:    number
  estado:       string
  tipoEntrega:  string
  fotosUrls:    string[]
  vistas:       number
  contactos:    number
  publicadoEn:  string
  actualizadoEn:string
  vendidoEn:    string | null
  precioFinalARS: number | null
  comisionRodaid: number | null
  bicicleta: { id: string; numeroSerie: string; marca: string; modelo: string }
  cit: {
    id: string; numeroCIT: string; estado: string; puntosTotal: number
    hashSHA256: string | null; fechaVencimiento: string | null; vigente: boolean
  } | null
}

export interface ResumenMisPublicaciones {
  total: number; activas: number; pausadas: number; vendidas: number
  valorActivoARS: number; cobradoARS: number
  totalVistas: number; totalContactos: number
}

// ══════════════════════════════════════════════════════════
// BFA TRANSFERS (stubs — integración futura)
// ══════════════════════════════════════════════════════════
export interface PendingBFATransfer { transaccionId: string; tokenId: number; newOwner: string }
export async function getPendingBFATransfers(): Promise<PendingBFATransfer[]> { return [] }
export async function reintentarBFATransfer(_id: string): Promise<{ok: boolean; txHash: string|null}> { return {ok:true, txHash:null} }
export async function iniciarCompra(input: {publicacionId:string; compradorId:string}) {
  throw new AppError('Compra en línea próximamente disponible', 501, 'NOT_IMPLEMENTED')
}
export async function confirmarEntrega(input: {transaccionId:string; compradorId:string}) {
  throw new AppError('Confirmación de entrega próximamente disponible', 501, 'NOT_IMPLEMENTED')
}
