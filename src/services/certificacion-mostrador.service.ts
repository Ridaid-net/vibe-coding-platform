import { createHash, randomBytes } from 'node:crypto'
import { ApiError, getPool } from '@/lib/marketplace'
import { hashPassword, USUARIO_PUBLIC_COLUMNS, type UsuarioRow } from '@/lib/auth'
import { enviarEmail } from '@/lib/email'
import { solicitarCitExpressConPago } from '@/src/services/cit-express-pago.service'

/**
 * RODAID — "Iniciar Certificacion" (Panel del Taller Aliado).
 *
 * Cliente de mostrador sin cuenta en RODAID: el taller carga sus datos y los
 * de la bici, el sistema arma la cuenta automaticamente (contrasena aleatoria
 * que nadie conoce, nunca expuesta) y dispara el mismo flujo de CIT Express
 * con cobro online que ya existe (cit-express-pago.service.ts) -- el taller
 * le muestra/manda el link de pago al cliente, y por mail le llega ademas un
 * link para "reclamar" su cuenta y elegir su propia contrasena.
 *
 * Restringido a aliados tipo='taller' -- mismo criterio de capacidad mecanica
 * que ya rige el sellado de inspecciones (ver inspeccion.service.ts).
 */

const TOKEN_INVITACION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CertificacionMostradorInput {
  clienteNombre: string
  clienteEmail: string
  clienteTelefono?: string | null
  bici: {
    marca: string
    modelo: string
    numeroSerie: string
    tipo: string
    anio?: number | null
    color?: string | null
    rodado?: number | null
    talleCuadro?: string | null
  }
}

export interface CertificacionMostradorResultado {
  usuarioId: string
  bicicletaId: string
  cuentaNueva: boolean
  initPoint: string
  montoARS: number
}

export async function iniciarCertificacionMostrador(
  aliadoId: string,
  input: CertificacionMostradorInput
): Promise<CertificacionMostradorResultado> {
  const pool = getPool()
  const email = input.clienteEmail.trim().toLowerCase()

  // 1. Buscar o crear la cuenta del cliente.
  const existente = await pool.query<{ id: string }>(
    `SELECT id FROM usuarios WHERE lower(email) = $1 LIMIT 1`,
    [email]
  )

  let usuarioId: string
  let cuentaNueva: boolean

  if (existente.rows[0]) {
    usuarioId = existente.rows[0].id
    cuentaNueva = false
  } else {
    // Contrasena aleatoria de alta entropia -- nadie la conoce, nunca se
    // expone ni se envia. El cliente la reemplaza al reclamar su cuenta.
    const passwordAleatoria = randomBytes(24).toString('hex')
    const passwordHash = await hashPassword(passwordAleatoria)
    const datosPerfil = {
      nombre: input.clienteNombre,
      telefono: input.clienteTelefono || undefined,
      origen: 'taller_mostrador',
    }
    const creado = await pool.query<{ id: string }>(
      `
        INSERT INTO usuarios (email, password_hash, rol, datos_perfil, proveedor)
        VALUES ($1, $2, 'ciclista', $3::jsonb, 'local')
        RETURNING id
      `,
      [email, passwordHash, JSON.stringify(datosPerfil)]
    )
    usuarioId = creado.rows[0].id
    cuentaNueva = true
  }

  // 2. Numero de serie unico a nivel base -- anticipamos el 409.
  const numeroSerieDup = await pool.query(
    `SELECT 1 FROM bicicletas WHERE numero_serie = $1 LIMIT 1`,
    [input.bici.numeroSerie]
  )
  if (numeroSerieDup.rowCount) {
    throw new ApiError(
      409,
      'NUMERO_SERIE_DUPLICADO',
      'Ya existe una bicicleta registrada con ese numero de serie.'
    )
  }

  // 3. Crear la bicicleta a nombre del cliente.
  const bici = await pool.query<{ id: string }>(
    `
      INSERT INTO bicicletas (
        marca, modelo, numero_serie, tipo, anio, color,
        propietario_id, rodado, talle_cuadro
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      input.bici.marca,
      input.bici.modelo,
      input.bici.numeroSerie,
      input.bici.tipo,
      input.bici.anio ?? null,
      input.bici.color ?? null,
      usuarioId,
      input.bici.rodado ?? null,
      input.bici.talleCuadro ?? null,
    ]
  )
  const bicicletaId = bici.rows[0].id

  // 4. Arrancar el mismo CIT Express con cobro online que ya existe.
  const pago = await solicitarCitExpressConPago({
    bicicletaId,
    ciclistaId: usuarioId,
    ciclistaEmail: email,
    ciclistaNombre: input.clienteNombre,
  })

  // 5. Cuenta nueva: token de invitacion para que el cliente elija su propia
  //    contrasena. Cuenta existente: ya tiene la suya, no hace falta.
  let tokenInvitacion: string | null = null
  if (cuentaNueva) {
    tokenInvitacion = randomBytes(32).toString('hex')
    await pool.query(
      `
        INSERT INTO invitaciones_cuenta (usuario_id, token_hash, expira_en)
        VALUES ($1, $2, $3)
      `,
      [usuarioId, hashToken(tokenInvitacion), new Date(Date.now() + TOKEN_INVITACION_TTL_MS)]
    )
  }

  // Best-effort: un fallo de envio no debe tumbar el tramite ya creado -- el
  // taller igual ve el link de pago en su panel y se lo puede pasar a mano.
  try {
    const reclamarUrl = tokenInvitacion
      ? `https://rodaid.net/reclamar-cuenta?token=${tokenInvitacion}`
      : null
    await enviarEmail({
      to: email,
      subject: 'RODAID — Tu certificacion CIT Express',
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
        <h2>¡Hola ${input.clienteNombre}!</h2>
        <p>El taller inicio la certificacion CIT Express de tu bici en RODAID.</p>
        ${
          reclamarUrl
            ? `<p>Te creamos una cuenta -- <a href="${reclamarUrl}">hace click aca para elegir tu contrasena</a> y acceder a tu Garaje Digital.</p>`
            : ''
        }
        <p><a href="${pago.initPoint}">Pagá tu CIT Express (${pago.montoARS.toLocaleString('es-AR')} ARS)</a> para activar la verificacion.</p>
      </div>`,
    })
  } catch (err) {
    console.error('Error email iniciar-certificacion:', err)
  }

  return {
    usuarioId,
    bicicletaId,
    cuentaNueva,
    initPoint: pago.initPoint,
    montoARS: pago.montoARS,
  }
}

/**
 * Reclama una cuenta creada por un taller: valida el token, setea la
 * contrasena elegida por el cliente y devuelve la fila actualizada para que
 * el caller pueda iniciarle sesion de una (mismo criterio que el registro
 * normal).
 */
export async function reclamarCuenta(token: string, password: string): Promise<UsuarioRow> {
  const pool = getPool()
  const tokenHash = hashToken(token)

  const inv = await pool.query<{ id: string; usuario_id: string; expira_en: string; usado_en: string | null }>(
    `SELECT id, usuario_id, expira_en, usado_en FROM invitaciones_cuenta WHERE token_hash = $1 LIMIT 1`,
    [tokenHash]
  )
  const fila = inv.rows[0]
  if (!fila) {
    throw new ApiError(404, 'TOKEN_INVALIDO', 'El link de invitacion no es valido.')
  }
  if (fila.usado_en) {
    throw new ApiError(409, 'TOKEN_YA_USADO', 'Este link ya fue usado. Inicia sesion normalmente.')
  }
  if (new Date(fila.expira_en).getTime() < Date.now()) {
    throw new ApiError(410, 'TOKEN_VENCIDO', 'Este link vencio. Pedile al taller que te genere uno nuevo.')
  }

  const passwordHash = await hashPassword(password)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const actualizado = await client.query<UsuarioRow>(
      `
        UPDATE usuarios SET password_hash = $2, email_verificado = TRUE, updated_at = NOW()
        WHERE id = $1
        RETURNING ${USUARIO_PUBLIC_COLUMNS}, password_hash
      `,
      [fila.usuario_id, passwordHash]
    )
    await client.query(
      `UPDATE invitaciones_cuenta SET usado_en = NOW() WHERE id = $1`,
      [fila.id]
    )
    await client.query('COMMIT')
    return actualizado.rows[0]
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
