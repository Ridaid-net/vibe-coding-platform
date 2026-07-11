import { ApiError, getPool } from '@/lib/marketplace'
import { StorageError, subirLogoTaller } from '@/src/services/storage.service'
import { esServicioAliadoValido, normalizarWhatsapp } from '@/lib/aliado-servicios'

const UMBRAL_CLAVE = 'umbral_cits_dia_promedio_30d'

async function obtenerUmbral(): Promise<number> {
  const res = await getPool().query<{ valor: string }>(
    `SELECT valor FROM parametros_ranking_talleres WHERE clave = $1`,
    [UMBRAL_CLAVE]
  )
  return res.rows[0] ? parseFloat(res.rows[0].valor) : 6
}

/**
 * Recalcula el promedio de CITs/dia (30 dias) de cada aliado aprobado y
 * despublica automaticamente a quien haya caido por debajo del umbral. Las
 * dos queries son idempotentes: correrlas de nuevo sin cambios de datos no
 * tiene efecto adicional.
 */
export async function recalcularDesempenoTalleres(): Promise<{
  actualizados: number
  despublicados: number
}> {
  const pool = getPool()
  const umbral = await obtenerUmbral()

  const actualizados = await pool.query(
    `
    UPDATE aliados a
    SET cits_promedio_30d = COALESCE(c.total, 0) / 30.0,
        puede_publicar_servicios = (COALESCE(c.total, 0) / 30.0) >= $1,
        desempeno_calculado_en = NOW()
    FROM aliados aa
    LEFT JOIN (
      SELECT COALESCE(taller_id, aliado_id) AS aliado_id, COUNT(*) AS total
      FROM inspecciones_fisicas
      WHERE resultado = 'APROBADA' AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY COALESCE(taller_id, aliado_id)
    ) c ON c.aliado_id = aa.id
    WHERE a.id = aa.id AND aa.estado = 'aprobado'
    RETURNING a.id
    `,
    [umbral]
  )

  const despublicados = await pool.query(
    `
    UPDATE aliado_servicios_publicados p
    SET publicado = false, updated_at = NOW()
    WHERE p.publicado = true
      AND EXISTS (SELECT 1 FROM aliados a WHERE a.id = p.aliado_id AND a.puede_publicar_servicios = false)
    RETURNING p.aliado_id
    `
  )

  return {
    actualizados: actualizados.rowCount ?? 0,
    despublicados: despublicados.rowCount ?? 0,
  }
}

export interface EstadoPublicacionTaller {
  puedePublicar: boolean
  citsPromedio30d: number
  umbral: number
  publicacion: {
    servicio: string
    precioArs: number
    logoUrl: string
    linkTienda: string | null
    whatsappNumero: string | null
    publicado: boolean
  } | null
}

export async function obtenerEstadoPublicacionTaller(
  aliadoId: string
): Promise<EstadoPublicacionTaller> {
  const pool = getPool()
  const umbral = await obtenerUmbral()

  const aliadoRes = await pool.query<{
    cits_promedio_30d: string
    puede_publicar_servicios: boolean
  }>(
    `SELECT cits_promedio_30d, puede_publicar_servicios FROM aliados WHERE id = $1`,
    [aliadoId]
  )
  const aliado = aliadoRes.rows[0]
  if (!aliado) {
    throw new ApiError(404, 'ALIADO_NO_ENCONTRADO', 'No encontramos tu perfil de aliado.')
  }

  const pubRes = await pool.query<{
    servicio: string
    precio_ars: string
    logo_url: string
    link_tienda: string | null
    whatsapp_numero: string | null
    publicado: boolean
  }>(
    `SELECT servicio, precio_ars, logo_url, link_tienda, whatsapp_numero, publicado FROM aliado_servicios_publicados WHERE aliado_id = $1`,
    [aliadoId]
  )
  const pub = pubRes.rows[0]

  return {
    puedePublicar: aliado.puede_publicar_servicios,
    citsPromedio30d: parseFloat(aliado.cits_promedio_30d),
    umbral,
    publicacion: pub
      ? {
          servicio: pub.servicio,
          precioArs: parseFloat(pub.precio_ars),
          logoUrl: pub.logo_url,
          linkTienda: pub.link_tienda,
          whatsappNumero: pub.whatsapp_numero,
          publicado: pub.publicado,
        }
      : null,
  }
}

export async function publicarServicioTaller(opts: {
  aliadoId: string
  servicio: string
  precioArs: number
  logoFile: File | null
  linkTienda: string | null
  whatsappNumero: string | null
}): Promise<void> {
  const { aliadoId, servicio, precioArs, logoFile, linkTienda, whatsappNumero } = opts

  if (!esServicioAliadoValido(servicio)) {
    throw new ApiError(400, 'SERVICIO_INVALIDO', 'Elegí un servicio de la lista.')
  }
  if (!(precioArs > 0)) {
    throw new ApiError(400, 'PRECIO_INVALIDO', 'El precio tiene que ser mayor a 0.')
  }
  const whatsappNormalizado = whatsappNumero ? normalizarWhatsapp(whatsappNumero) : null
  if (whatsappNumero && !whatsappNormalizado) {
    throw new ApiError(
      400,
      'WHATSAPP_INVALIDO',
      'El WhatsApp tiene que tener el formato código de país + número, sin espacios ni "+" (ej. 5492617542335).'
    )
  }

  const pool = getPool()

  // Nunca confiar en que el boton estuvo oculto en el cliente: se revalida acá.
  const estadoRes = await pool.query<{ puede_publicar_servicios: boolean }>(
    `SELECT puede_publicar_servicios FROM aliados WHERE id = $1`,
    [aliadoId]
  )
  if (!estadoRes.rows[0]?.puede_publicar_servicios) {
    throw new ApiError(
      403,
      'UMBRAL_NO_ALCANZADO',
      'Todavía no llegaste al promedio de CITs/día necesario para publicar.'
    )
  }

  const existenteRes = await pool.query<{ logo_url: string }>(
    `SELECT logo_url FROM aliado_servicios_publicados WHERE aliado_id = $1`,
    [aliadoId]
  )
  let logoUrl = existenteRes.rows[0]?.logo_url ?? null

  if (logoFile) {
    try {
      logoUrl = (await subirLogoTaller(aliadoId, logoFile)).url
    } catch (error) {
      if (error instanceof StorageError) {
        throw new ApiError(400, error.code, error.message)
      }
      throw error
    }
  }
  if (!logoUrl) {
    throw new ApiError(400, 'LOGO_REQUERIDO', 'Subí el logo de tu taller.')
  }

  await pool.query(
    `
    INSERT INTO aliado_servicios_publicados (aliado_id, servicio, precio_ars, logo_url, link_tienda, whatsapp_numero, publicado)
    VALUES ($1, $2, $3, $4, $5, $6, true)
    ON CONFLICT (aliado_id) DO UPDATE SET
      servicio = EXCLUDED.servicio,
      precio_ars = EXCLUDED.precio_ars,
      logo_url = EXCLUDED.logo_url,
      link_tienda = EXCLUDED.link_tienda,
      whatsapp_numero = EXCLUDED.whatsapp_numero,
      publicado = true,
      updated_at = NOW()
    `,
    [aliadoId, servicio, precioArs, logoUrl, linkTienda, whatsappNormalizado]
  )
}

export interface ServicioPublicadoRanking {
  aliadoId: string
  nombreTaller: string
  servicio: string
  precioArs: number
  logoUrl: string
  linkTienda: string | null
  whatsappNumero: string | null
}

/** Lectura publica, ya ordenada por desempeño — no expone el numero crudo de CITs/dia. */
interface FilaServicioPublicadoRanking {
  aliado_id: string
  nombre: string
  servicio: string
  precio_ars: string
  logo_url: string
  link_tienda: string | null
  whatsapp_numero: string | null
}

export async function obtenerServiciosPublicadosRanking(): Promise<ServicioPublicadoRanking[]> {
  const pool = getPool()
  const res = await pool.query<FilaServicioPublicadoRanking>(
    `
    SELECT p.aliado_id, a.nombre, p.servicio, p.precio_ars, p.logo_url, p.link_tienda, p.whatsapp_numero
    FROM aliado_servicios_publicados p
    JOIN aliados a ON a.id = p.aliado_id
    WHERE p.publicado = true AND a.puede_publicar_servicios = true
    ORDER BY a.cits_promedio_30d DESC
    LIMIT 20
    `
  )
  return res.rows.map((r: FilaServicioPublicadoRanking) => ({
    aliadoId: r.aliado_id,
    nombreTaller: r.nombre,
    servicio: r.servicio,
    precioArs: parseFloat(r.precio_ars),
    logoUrl: r.logo_url,
    linkTienda: r.link_tienda,
    whatsappNumero: r.whatsapp_numero,
  }))
}
