import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, getPool, jsonError, requireUser } from '@/lib/marketplace'

export const runtime = 'nodejs'

interface BiciGarajeRow {
  id: string
  marca: string
  modelo: string
  numero_serie: string
  tipo: string
  anio: number | null
  color: string | null
  foto_url: string | null
  rodado: string | null
  talle_cuadro: string | null
  cit_id: string | null
  cit_estado: string | null
  cit_vencimiento: string | null
  cit_activo: boolean
  tiene_publicacion_activa: boolean
}

/**
 * GET /api/v1/bicicletas — "Mi Garaje".
 *
 * Lista las bicicletas del usuario autenticado junto con el estado de su CIT
 * (identidad verificada) y si ya tienen una publicacion activa. Es la fuente de
 * datos del componente BicycleSelector del flujo de publicacion: con esta
 * informacion el frontend decide si puede mostrar el formulario o el estado de
 * bloqueo ("necesitas una bicicleta con identidad verificada").
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const pool = getPool()

    // Para cada bicicleta del usuario traemos: el CIT mas reciente en estado
    // 'activo' y vigente (si existe) y si tiene una publicacion ACTIVA/PAUSADA.
    const result = await pool.query<BiciGarajeRow>(
      `
        SELECT
          b.id,
          b.marca,
          b.modelo,
          b.numero_serie,
          b.tipo,
          b.anio,
          b.color,
          b.foto_url,
          b.rodado,
          b.talle_cuadro,
          c.id AS cit_id,
          c.estado AS cit_estado,
          c.fecha_vencimiento AS cit_vencimiento,
          COALESCE(
            c.estado = 'activo' AND c.fecha_vencimiento > NOW(),
            FALSE
          ) AS cit_activo,
          EXISTS (
            SELECT 1
            FROM marketplace_publicaciones mp
            WHERE mp.bicicleta_id = b.id
              AND mp.estado IN ('ACTIVA', 'PAUSADA')
          ) AS tiene_publicacion_activa
        FROM bicicletas b
        LEFT JOIN LATERAL (
          SELECT id, estado, fecha_vencimiento
          FROM cits
          WHERE cits.bicicleta_id = b.id
          ORDER BY
            (estado = 'activo') DESC,
            fecha_vencimiento DESC,
            created_at DESC
          LIMIT 1
        ) c ON TRUE
        WHERE b.propietario_id = $1
        ORDER BY b.created_at DESC
      `,
      [user.id]
    )

    const bicicletas = result.rows.map((row: BiciGarajeRow) => ({
      id: row.id,
      marca: row.marca,
      modelo: row.modelo,
      numeroSerie: row.numero_serie,
      tipo: row.tipo,
      anio: row.anio,
      color: row.color,
      fotoUrl: row.foto_url,
      rodado: row.rodado === null ? null : Number(row.rodado),
      talleCuadro: row.talle_cuadro,
      citId: row.cit_id,
      citEstado: row.cit_estado,
      citVencimiento: row.cit_vencimiento,
      citActivo: row.cit_activo,
      tienePublicacionActiva: row.tiene_publicacion_activa,
    }))

    return NextResponse.json({
      bicicletas,
      // Atajo util para el BicycleSelector: si no hay ninguna verificada, el
      // formulario se bloquea.
      tieneVerificada: bicicletas.some((b: { citActivo: boolean }) => b.citActivo),
    })
  } catch (error) {
    return jsonError(error)
  }
}

// Alta de bicicleta en "Mi Garaje". El rodado se valida contra la misma lista
// que la restriccion CHECK de la base; el resto son longitudes razonables.
const RODADOS_VALIDOS = [12, 16, 20, 24, 26, 27.5, 29, 700] as const

const crearBicicletaSchema = z.object({
  marca: z
    .string({ required_error: 'La marca es obligatoria.' })
    .trim()
    .min(1, 'La marca es obligatoria.')
    .max(80, 'La marca no puede superar 80 caracteres.'),
  modelo: z
    .string({ required_error: 'El modelo es obligatorio.' })
    .trim()
    .min(1, 'El modelo es obligatorio.')
    .max(120, 'El modelo no puede superar 120 caracteres.'),
  numeroSerie: z
    .string({ required_error: 'El numero de serie es obligatorio.' })
    .trim()
    .min(3, 'El numero de serie debe tener al menos 3 caracteres.')
    .max(120, 'El numero de serie no puede superar 120 caracteres.'),
  tipo: z
    .string({ required_error: 'El tipo es obligatorio.' })
    .trim()
    .min(1, 'El tipo es obligatorio.')
    .max(40, 'El tipo no puede superar 40 caracteres.'),
  anio: z
    .number()
    .int()
    .min(1950, 'El ano debe ser posterior a 1950.')
    .max(2100, 'El ano es invalido.')
    .nullable()
    .optional(),
  color: z.string().trim().max(40).nullable().optional(),
  rodado: z
    .number()
    .refine((v) => RODADOS_VALIDOS.includes(v as (typeof RODADOS_VALIDOS)[number]), {
      message: 'Rodado invalido.',
    })
    .nullable()
    .optional(),
  talleCuadro: z.enum(['S', 'M', 'L', 'XL']).nullable().optional(),
})

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as Record<string, unknown>

    const raw = {
      marca: body.marca,
      modelo: body.modelo,
      numeroSerie: body.numeroSerie ?? body.numero_serie,
      tipo: body.tipo,
      anio: toNumberOrUndefined(body.anio),
      color: typeof body.color === 'string' && body.color.trim() ? body.color : undefined,
      rodado: toNumberOrUndefined(body.rodado),
      talleCuadro: body.talleCuadro ?? body.talle_cuadro ?? undefined,
    }

    const parsed = crearBicicletaSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos invalidos.')
    }
    const data = parsed.data

    const pool = getPool()

    // El numero de serie es unico a nivel base: anticipamos el 409 con un
    // mensaje claro en lugar de dejar reventar la constraint.
    const existing = await pool.query(
      `SELECT 1 FROM bicicletas WHERE numero_serie = $1 LIMIT 1`,
      [data.numeroSerie]
    )
    if (existing.rowCount) {
      throw new ApiError(
        409,
        'NUMERO_SERIE_DUPLICADO',
        'Ya existe una bicicleta registrada con ese numero de serie.'
      )
    }

    const insert = await pool.query<{ id: string }>(
      `
        INSERT INTO bicicletas (
          marca, modelo, numero_serie, tipo, anio, color,
          propietario_id, rodado, talle_cuadro
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `,
      [
        data.marca,
        data.modelo,
        data.numeroSerie,
        data.tipo,
        data.anio ?? null,
        data.color ?? null,
        user.id,
        data.rodado ?? null,
        data.talleCuadro ?? null,
      ]
    )

    return NextResponse.json(
      { bicicleta: { id: insert.rows[0].id } },
      { status: 201 }
    )
  } catch (error) {
    return jsonError(error)
  }
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isNaN(parsed) ? undefined : parsed
}
