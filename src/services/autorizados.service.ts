import { ApiError, getPool } from '@/lib/marketplace'
import { cifrarAutorizado, descifrarAutorizado } from '@/src/services/cifrado.service'

/**
 * RODAID — "Uso autorizado": hasta 2 personas adicionales por bici, cargadas
 * por el dueño desde el Garaje Digital.
 *
 * DNI y direccion viajan cifrados en reposo (AES-256-GCM, clave propia --
 * ver cifrado.service.ts). El nivel de exposicion en la verificacion
 * (publica vs. gov) se resuelve en verificacion.service.ts / gov/verificar,
 * NO aca -- este servicio siempre devuelve los datos completos
 * descifrados; el caller decide cuanto mostrar segun el canal.
 */

const MAX_AUTORIZADOS_POR_BICI = 2

interface AutorizadoRow {
  id: string
  bicicleta_id: string
  nombre_completo: string
  dni_cifrado: string
  direccion_cifrada: string
  telefono: string | null
  created_at: string
  updated_at: string
}

export interface AutorizadoCompleto {
  id: string
  bicicletaId: string
  nombreCompleto: string
  dni: string
  direccion: string
  telefono: string | null
  createdAt: string
  updatedAt: string
}

function mapAutorizado(row: AutorizadoRow): AutorizadoCompleto {
  return {
    id: row.id,
    bicicletaId: row.bicicleta_id,
    nombreCompleto: row.nombre_completo,
    dni: descifrarAutorizado(row.dni_cifrado),
    direccion: descifrarAutorizado(row.direccion_cifrada),
    telefono: row.telefono,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Cantidad de personas con uso autorizado -- lo unico que ve el publico/no-Ministerio. */
export async function contarAutorizados(bicicletaId: string): Promise<number> {
  const res = await getPool().query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM bicicletas_autorizados WHERE bicicleta_id = $1`,
    [bicicletaId]
  )
  return Number(res.rows[0]?.cnt ?? 0)
}

/** Lista completa y descifrada -- solo para el dueño (Garaje) o Ministerio de Seguridad. */
export async function listarAutorizadosCompleto(bicicletaId: string): Promise<AutorizadoCompleto[]> {
  const res = await getPool().query<AutorizadoRow>(
    `SELECT * FROM bicicletas_autorizados WHERE bicicleta_id = $1 ORDER BY created_at ASC`,
    [bicicletaId]
  )
  return res.rows.map(mapAutorizado)
}

export async function validarOwnershipAutorizados(usuarioId: string, bicicletaId: string): Promise<void> {
  const bici = await getPool().query<{ propietario_id: string }>(
    `SELECT propietario_id FROM bicicletas WHERE id = $1 LIMIT 1`,
    [bicicletaId]
  )
  if (!bici.rows[0]) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
  }
  if (bici.rows[0].propietario_id !== usuarioId) {
    throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }
}

export interface AutorizadoInput {
  nombreCompleto: string
  dni: string
  direccion: string
  telefono?: string | null
}

/** Agrega una persona autorizada. Rechaza con 409 si ya hay 2. */
export async function agregarAutorizado(
  usuarioId: string,
  bicicletaId: string,
  input: AutorizadoInput
): Promise<AutorizadoCompleto> {
  await validarOwnershipAutorizados(usuarioId, bicicletaId)

  const actual = await contarAutorizados(bicicletaId)
  if (actual >= MAX_AUTORIZADOS_POR_BICI) {
    throw new ApiError(
      409,
      'LIMITE_AUTORIZADOS',
      `Ya cargaste el máximo de ${MAX_AUTORIZADOS_POR_BICI} personas autorizadas para esta bici.`
    )
  }

  const res = await getPool().query<AutorizadoRow>(
    `
      INSERT INTO bicicletas_autorizados (bicicleta_id, nombre_completo, dni_cifrado, direccion_cifrada, telefono)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [
      bicicletaId,
      input.nombreCompleto,
      cifrarAutorizado(input.dni),
      cifrarAutorizado(input.direccion),
      input.telefono ?? null,
    ]
  )
  return mapAutorizado(res.rows[0])
}

/** Edita una persona autorizada existente. */
export async function editarAutorizado(
  usuarioId: string,
  bicicletaId: string,
  autorizadoId: string,
  input: AutorizadoInput
): Promise<AutorizadoCompleto> {
  await validarOwnershipAutorizados(usuarioId, bicicletaId)

  const res = await getPool().query<AutorizadoRow>(
    `
      UPDATE bicicletas_autorizados
      SET nombre_completo = $3, dni_cifrado = $4, direccion_cifrada = $5, telefono = $6, updated_at = NOW()
      WHERE id = $1 AND bicicleta_id = $2
      RETURNING *
    `,
    [
      autorizadoId,
      bicicletaId,
      input.nombreCompleto,
      cifrarAutorizado(input.dni),
      cifrarAutorizado(input.direccion),
      input.telefono ?? null,
    ]
  )
  if (!res.rows[0]) {
    throw new ApiError(404, 'AUTORIZADO_NOT_FOUND', 'No encontramos esa persona autorizada.')
  }
  return mapAutorizado(res.rows[0])
}

/** Quita una persona autorizada. */
export async function eliminarAutorizado(
  usuarioId: string,
  bicicletaId: string,
  autorizadoId: string
): Promise<void> {
  await validarOwnershipAutorizados(usuarioId, bicicletaId)

  const res = await getPool().query(
    `DELETE FROM bicicletas_autorizados WHERE id = $1 AND bicicleta_id = $2`,
    [autorizadoId, bicicletaId]
  )
  if (!res.rowCount) {
    throw new ApiError(404, 'AUTORIZADO_NOT_FOUND', 'No encontramos esa persona autorizada.')
  }
}
