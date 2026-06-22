// ─── RODAID · Marketplace Controller ─────────────────────
// POST   /marketplace/publicar          → publicar bicicleta
// GET    /marketplace                   → listar publicaciones
// GET    /marketplace/mis-publicaciones → publicaciones del vendedor
// GET    /marketplace/:slug             → detalle de publicación
// PATCH  /marketplace/:id               → editar publicación
// PATCH  /marketplace/:id/estado        → pausar/activar/cancelar
// POST   /marketplace/:id/vender        → marcar vendida
// POST   /marketplace/:id/contactar     → enviar consulta
// GET    /admin/marketplace             → admin: todas las publicaciones

import { Request, Response } from 'express'
import { z } from 'zod'
import { AuthRequest }   from '../types'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import { buscarPublicaciones, sugerirPublicaciones, invalidarCacheSearch } from '../services/marketplace.search'
import {
  publicarBicicleta, listarPublicaciones, getPublicacion,
  editarPublicacion, pausarPublicacion, marcarVendida as svcVendida,
  registrarContacto, misPublicaciones as svcMis,
} from '../services/marketplace.service'
import { query } from '../config/database'

// ══════════════════════════════════════════════════════════
// PUBLICAR — POST /marketplace/publicar
// ══════════════════════════════════════════════════════════
export const publicar = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Autenticación requerida', 401)

  const body = z.object({
    citId:       z.string().uuid('citId debe ser un UUID válido'),
    titulo:      z.string().min(10, 'Mínimo 10 caracteres').max(120, 'Máximo 120 caracteres'),
    descripcion: z.string().min(20, 'Mínimo 20 caracteres').max(3000),
    precioARS:   z.number().positive().max(50_000_000, 'Precio máximo $50M ARS'),
    precioUSD:   z.number().positive().optional(),
    fotosUrls:   z.array(z.string().url()).max(10).optional(),
  }).parse(req.body)

  const pub = await publicarBicicleta({
    vendedorId: req.user.sub,
    ...body,
  })

  res.status(201).json({
    ok:      true,
    data:    pub,
    message: `Publicación creada: ${pub.slug}`,
  })
})

// ══════════════════════════════════════════════════════════
// BUSCAR + LISTAR — GET /marketplace
// ══════════════════════════════════════════════════════════
export const buscar = asyncHandler(async (req: Request, res: Response) => {
  const q = z.object({
    q:          z.string().max(100).optional(),
    marca:      z.string().optional(),
    tipo:       z.string().optional(),
    anio_min:   z.coerce.number().int().optional(),
    anio_max:   z.coerce.number().int().optional(),
    precio_min: z.coerce.number().optional(),
    precio_max: z.coerce.number().optional(),
    estado:     z.enum(['ACTIVA','VENDIDA','PAUSADA']).optional(),
    orden:      z.enum(['relevancia','precio_asc','precio_desc','recientes','vistas']).optional(),
    pagina:     z.coerce.number().int().positive().default(1),
    limite:     z.coerce.number().int().min(1).max(50).default(12),
  }).parse(req.query)

  const result = await buscarPublicaciones(q)
  res.setHeader('X-Total-Count',  String(result.total))
  res.setHeader('X-Page',         String(result.pagina))
  res.setHeader('X-Pages',        String(result.paginas))
  res.setHeader('X-Search-Ms',    String(result.tiempoMs))
  res.setHeader('X-From-Cache',   result.fromCache ? '1' : '0')
  res.json({ ok: true, data: result })
})

export const listar = asyncHandler(async (req: Request, res: Response) => {
  const q = z.object({
    estado:    z.enum(['ACTIVA','VENDIDA','PAUSADA']).optional(),
    marcas:    z.string().optional(),          // "Trek,Giant" → array
    tipo:      z.string().optional(),
    precioMin: z.coerce.number().optional(),
    precioMax: z.coerce.number().optional(),
    orden:     z.enum(['precio_asc','precio_desc','recientes','vistas']).optional(),
    pagina:    z.coerce.number().int().positive().default(1),
    limite:    z.coerce.number().int().min(1).max(50).default(12),
  }).parse(req.query)

  const result = await listarPublicaciones({
    estado:    q.estado,
    marcas:    q.marcas?.split(',').filter(Boolean),
    tipo:      q.tipo,
    precioMin: q.precioMin,
    precioMax: q.precioMax,
    orden:     q.orden,
    pagina:    q.pagina,
    limite:    q.limite,
  })

  res.setHeader('X-Total-Count', String(result.total))
  res.setHeader('X-Page',        String(result.pagina))
  res.setHeader('X-Pages',       String(result.paginas))
  res.json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// MIS PUBLICACIONES — GET /marketplace/mis-publicaciones
// ══════════════════════════════════════════════════════════
export const misPublicaciones = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Autenticación requerida', 401)

  const q = z.object({
    estado:    z.enum(['ACTIVA','PAUSADA','VENDIDA','CANCELADA','todas']).default('todas'),
    pagina:    z.coerce.number().int().min(1).default(1),
    porPagina: z.coerce.number().int().min(1).max(50).default(25),
  }).parse(req.query)

  const result = await svcMis({
    vendedorId: req.user.sub,
    estado:     q.estado as any,
    pagina:     q.pagina,
    porPagina:  q.porPagina,
  })

  res.json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// DETALLE — GET /marketplace/:slug
// ══════════════════════════════════════════════════════════
export const detalle = asyncHandler(async (req: Request, res: Response) => {
  const pub = await getPublicacion(req.params.slug)
  if (!pub) throw new AppError('Publicación no encontrada', 404)
  res.json({ ok: true, data: pub })
})

// ══════════════════════════════════════════════════════════
// EDITAR — PATCH /marketplace/:id
// ══════════════════════════════════════════════════════════
export const editar = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Autenticación requerida', 401)

  const body = z.object({
    titulo:      z.string().min(10).max(120).optional(),
    descripcion: z.string().min(20).max(3000).optional(),
    precioARS:   z.number().positive().max(50_000_000).optional(),
    precioUSD:   z.number().positive().nullable().optional(),
    fotosUrls:   z.array(z.string().url()).max(10).optional(),
  }).parse(req.body)

  const pub = await editarPublicacion({
    publicacionId: req.params.id,
    vendedorId:    req.user.sub,
    ...body,
    precioARS:     body.precioARS,
  })

  res.json({ ok: true, data: pub, message: 'Publicación actualizada' })
})

// ══════════════════════════════════════════════════════════
// CAMBIAR ESTADO — PATCH /marketplace/:id/estado
// ══════════════════════════════════════════════════════════
export const cambiarEstado = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Autenticación requerida', 401)

  const { estado } = z.object({
    estado: z.enum(['ACTIVA','PAUSADA','CANCELADA']),
  }).parse(req.body)

  const esAdmin = ['ADMIN','admin'].includes(req.user.rol as string)
  await pausarPublicacion(req.params.id, req.user.sub)
  res.json({ ok: true, data: { id: req.params.id } })
})

// ══════════════════════════════════════════════════════════
// MARCAR VENDIDA — POST /marketplace/:id/vender
// ══════════════════════════════════════════════════════════
export const vender = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Autenticación requerida', 401)

  const body = z.object({
    precioFinalARS: z.number().positive('Precio final requerido'),
    compradorId:    z.string().uuid().optional(),
  }).parse(req.body)

  const result = await svcVendida(
    req.params.id,
    req.user.sub,
    body.precioFinalARS,
    body.compradorId
  )

  res.json({
    ok:   true,
    data: result,
    message: `Venta registrada. Comisión RODAID: $${result.comisionRodaid.toLocaleString('es-AR')} ARS`,
  })
})

// ══════════════════════════════════════════════════════════
// CONTACTAR — POST /marketplace/:id/contactar
// ══════════════════════════════════════════════════════════
export const contactar = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({
    mensaje:  z.string().min(10, 'Mínimo 10 caracteres').max(1000),
    telefono: z.string().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
    email:    z.string().email().optional(),
  }).refine(d => d.telefono || d.email || req.user?.sub,
    { message: 'Incluí teléfono o email para que el vendedor pueda contactarte' }
  ).parse(req.body)

  const result = await registrarContacto({
    publicacionId: req.params.id,
    interesadoId:  req.user?.sub,
    ...body,
  })

  res.status(201).json({ ok: true, data: result, message: 'Consulta enviada al vendedor' })
})

// ══════════════════════════════════════════════════════════
// ADMIN — GET /admin/marketplace
// ══════════════════════════════════════════════════════════
export const adminListar = asyncHandler(async (req: Request, res: Response) => {
  const { estado, pagina = 1, limite = 50 } = z.object({
    estado: z.string().optional(),
    pagina: z.coerce.number().default(1),
    limite: z.coerce.number().max(100).default(50),
  }).parse(req.query)

  const offset = (pagina - 1) * limite
  const cond   = estado ? `WHERE mp.estado=$1::estado_publicacion` : ''
  const params = estado ? [estado, limite, offset] : [limite, offset]
  const pIdx   = estado ? 2 : 1

  const rows = await query<Record<string, unknown>>(
    `SELECT mp.id, mp.slug, mp.titulo, mp.precio_ars, mp.estado::text,
            mp.vistas, mp.contactos, mp.publicado_en, mp.vence_en,
            b.marca, b.modelo, b.anio, b.numero_serie AS serial,
            c.numero_cit, u.nombre AS vendedor_nombre, u.email AS vendedor_email
     FROM marketplace_publicaciones mp
     JOIN bicicletas b ON b.id=mp.bicicleta_id
     JOIN cits c ON c.id=mp.cit_id
     JOIN usuarios u ON u.id=mp.vendedor_id
     ${cond}
     ORDER BY mp.publicado_en DESC
     LIMIT $${pIdx} OFFSET $${pIdx+1}`,
    params
  )

  res.json({ ok: true, data: { publicaciones: rows, pagina, limite } })
})

// ══════════════════════════════════════════════════════════
// SUGERENCIAS — GET /marketplace/suggest?q=trek
// ══════════════════════════════════════════════════════════
export const suggest = asyncHandler(async (req: Request, res: Response) => {
  const { q, limite } = z.object({
    q:      z.string().min(2).max(50),
    limite: z.coerce.number().int().min(1).max(10).default(5),
  }).parse(req.query)
  const sugerencias = await sugerirPublicaciones(q, limite)
  res.json({ ok: true, data: sugerencias })
})
