import { createHash, randomBytes } from 'node:crypto'
import { ApiError, getPool, slugify } from '@/lib/marketplace'
import { hashPassword } from '@/lib/auth'
import { enviarEmail } from '@/lib/email'
import { obtenerDeudaPendiente } from '@/src/services/disputas-cit-completo.service'

/**
 * RODAID — Segundo punto de entrada a CIT Completo/Transferencia: "acuerdo
 * privado". Comprador y vendedor ya se pusieron de acuerdo por fuera de
 * RODAID (redes, boca a boca) y solo falta que un Taller Aliado corra la
 * verificacion de 20 puntos antes de transferir -- mismo producto, mismo
 * precio, mismo flujo de reserva/pago que el camino publico del Marketplace
 * (iniciarReservaCitCompleto/confirmarPagoCitCompleto en escrow.service.ts),
 * sin ningun cambio downstream.
 *
 * Iniciado por el VENDEDOR (no el Taller): es el unico de los dos que ya
 * tiene, en cada otro punto de este flujo (Reservar CIT, Retirar
 * publicacion, Editar publicacion), la relacion de ownership sobre la bici
 * -- el Taller no tiene forma de identificar la bici/al vendedor sin que el
 * vendedor participe primero.
 *
 * La fila que se crea es una marketplace_publicaciones real, con
 * origen='acuerdo_privado' (ver 20260723000008) para que quede fuera del
 * grid publico -- todo lo demas (proteccion de doble venta, indices,
 * columnas) es identico a una publicacion nacida del flujo normal.
 */

const TOKEN_INVITACION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CrearAcuerdoPrivadoInput {
  vendedorId: string
  bicicletaId: string
  aliadoId: string
  titulo: string
  descripcion: string
  precioARS: number
  precioUSD?: number | null
  compradorNombre: string
  compradorEmail: string
}

export interface AcuerdoPrivadoResultado {
  publicacionId: string
  slug: string
  compradorId: string
  compradorCuentaNueva: boolean
  aliadoNombre: string
}

export async function crearAcuerdoPrivado(
  input: CrearAcuerdoPrivadoInput
): Promise<AcuerdoPrivadoResultado> {
  const compradorEmail = input.compradorEmail.trim().toLowerCase()
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // 1. La bicicleta debe existir y pertenecer al vendedor autenticado --
    //    mismos 5 chequeos que el flujo publico (publicar/route.ts), en el
    //    mismo orden, para que un acuerdo privado nunca sea mas facil de
    //    crear que una publicacion normal.
    const biciResult = await client.query<{
      id: string
      propietario_id: string
      marca: string
      modelo: string
      anio: number | null
    }>(
      `SELECT id, propietario_id, marca, modelo, anio FROM bicicletas WHERE id = $1 FOR UPDATE`,
      [input.bicicletaId]
    )
    const bici = biciResult.rows[0]
    if (!bici) {
      throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
    }
    if (bici.propietario_id !== input.vendedorId) {
      throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
    }

    const citResult = await client.query<{ id: string; fecha_vencimiento: string | null }>(
      `
        SELECT id, fecha_vencimiento
        FROM cits
        WHERE bicicleta_id = $1 AND estado = 'activo'
        ORDER BY acunado_en DESC
        LIMIT 1
        FOR UPDATE
      `,
      [bici.id]
    )
    const cit = citResult.rows[0]
    if (!cit) {
      throw new ApiError(403, 'CIT_NOT_ACTIVE', 'La bicicleta no esta verificada con un CIT activo.')
    }
    if (cit.fecha_vencimiento !== null && new Date(cit.fecha_vencimiento).getTime() <= Date.now()) {
      throw new ApiError(403, 'CIT_EXPIRED', 'El CIT de la bicicleta esta vencido.')
    }

    const bancoResult = await client.query(
      `SELECT 1 FROM datos_bancarios_payout WHERE beneficiario_tipo = 'usuario' AND beneficiario_id = $1 LIMIT 1`,
      [input.vendedorId]
    )
    if (!bancoResult.rowCount) {
      throw new ApiError(
        409,
        'DATOS_BANCARIOS_FALTANTES',
        'Antes de iniciar un acuerdo privado necesitas cargar un CBU o alias para poder cobrar tu venta.'
      )
    }

    const deuda = await obtenerDeudaPendiente(input.vendedorId)
    if (deuda) {
      throw new ApiError(
        409,
        'DEUDA_PENDIENTE',
        `Tenés una deuda pendiente de $${deuda.monto.toLocaleString('es-AR')} con RODAID antes de poder publicar de nuevo.`
      )
    }

    // Misma proteccion de "una sola publicacion viva por CIT" que el flujo
    // publico -- ver el comentario en publicar/route.ts sobre por que estos
    // 6 estados especificamente (idx_mp_publicaciones_unica_activa_por_cit).
    const duplicateResult = await client.query(
      `
        SELECT 1 FROM marketplace_publicaciones
        WHERE cit_id = $1
          AND estado IN (
            'ACTIVA', 'PAUSADA', 'PUBLICADO_PENDIENTE_CERTIFICACION',
            'PUBLICADO_CERTIFICADO', 'RESERVADO', 'EJECUTANDO_LOGISTICA'
          )
        LIMIT 1
      `,
      [cit.id]
    )
    if (duplicateResult.rowCount) {
      throw new ApiError(409, 'DUPLICATE_LISTING', 'Ya existe una publicacion activa para esta bicicleta.')
    }

    // 2. El Taller Aliado elegido debe existir y estar aprobado.
    const aliadoResult = await client.query<{ id: string; nombre: string; email: string }>(
      `SELECT id, nombre, email FROM aliados WHERE id = $1 AND estado = 'aprobado' LIMIT 1`,
      [input.aliadoId]
    )
    const aliado = aliadoResult.rows[0]
    if (!aliado) {
      throw new ApiError(404, 'ALIADO_NOT_FOUND', 'El taller elegido no existe o no esta aprobado.')
    }

    // 3. Vincular el Taller a la bici (aliado_servicios) COMO PRINCIPAL --
    //    el vendedor lo esta eligiendo explicitamente para esta venta, mismo
    //    criterio que otorgarAccesoTaller(..., esPrincipal: true): le saca
    //    el principal a quien lo tuviera (si habia uno) antes de vincular a
    //    este, para que resolverAliadoPorBicicleta() (escrow.service.ts) no
    //    bloquee /reservar con SIN_TALLER_VINCULADO. ON CONFLICT ...
    //    DO UPDATE (no DO NOTHING) para poder re-otorgar un vinculo que
    //    hubiera quedado revocado.
    await client.query(
      `UPDATE aliado_servicios SET es_principal = FALSE WHERE bicicleta_id = $1 AND es_principal = TRUE`,
      [bici.id]
    )
    await client.query(
      `
        INSERT INTO aliado_servicios (aliado_id, bicicleta_id, tipo_servicio, detalle, es_principal, revocado_en)
        VALUES ($1, $2, 'venta', 'Acuerdo privado: elegido por el vendedor al iniciar el tramite.', TRUE, NULL)
        ON CONFLICT (aliado_id, bicicleta_id)
          DO UPDATE SET es_principal = TRUE, revocado_en = NULL
      `,
      [aliado.id, bici.id]
    )

    // 4. Buscar o crear la cuenta del comprador -- mismo patron que
    //    iniciarCertificacionMostrador() (certificacion-mostrador.service.ts):
    //    contrasena aleatoria de alta entropia, nadie la conoce, el
    //    comprador la reemplaza al reclamar su cuenta via invitaciones_cuenta.
    const compradorExistente = await client.query<{ id: string }>(
      `SELECT id FROM usuarios WHERE lower(email) = $1 LIMIT 1`,
      [compradorEmail]
    )
    let compradorId: string
    let compradorCuentaNueva: boolean
    if (compradorExistente.rows[0]) {
      compradorId = compradorExistente.rows[0].id
      compradorCuentaNueva = false
    } else {
      const passwordAleatoria = randomBytes(24).toString('hex')
      const passwordHash = await hashPassword(passwordAleatoria)
      const datosPerfil = { nombre: input.compradorNombre, origen: 'acuerdo_privado_comprador' }
      const creado = await client.query<{ id: string }>(
        `
          INSERT INTO usuarios (email, password_hash, rol, datos_perfil, proveedor)
          VALUES ($1, $2, 'ciclista', $3::jsonb, 'local')
          RETURNING id
        `,
        [compradorEmail, passwordHash, JSON.stringify(datosPerfil)]
      )
      compradorId = creado.rows[0].id
      compradorCuentaNueva = true
    }
    if (compradorId === input.vendedorId) {
      throw new ApiError(422, 'COMPRADOR_ES_VENDEDOR', 'El comprador no puede ser el mismo vendedor.')
    }

    // 5. Registrar la publicacion sintetica -- estado directo a
    //    PUBLICADO_PENDIENTE_CERTIFICACION (nunca ACTIVA: esta bici ya tiene
    //    comprador, solo falta la verificacion del Taller, no la exposicion
    //    publica que ACTIVA representa) y origen='acuerdo_privado' (fuera
    //    del grid). Esto es lo unico que hace que /reservar
    //    (iniciarReservaCitCompleto) acepte esta fila -- ver el guard de esa
    //    funcion en escrow.service.ts.
    const slugBase = slugify([bici.marca, bici.modelo, bici.anio])
    const slug = `${slugBase}-${bici.id.slice(0, 6)}`
    const insertResult = await client.query<{ id: string; slug: string }>(
      `
        INSERT INTO marketplace_publicaciones (
          cit_id, bicicleta_id, vendedor_id, titulo, descripcion,
          precio_ars, precio_usd, fotos_urls, slug, estado, origen
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', $8, 'PUBLICADO_PENDIENTE_CERTIFICACION', 'acuerdo_privado')
        RETURNING id, slug
      `,
      [
        cit.id,
        bici.id,
        input.vendedorId,
        input.titulo,
        input.descripcion,
        input.precioARS,
        input.precioUSD ?? null,
        slug,
      ]
    )
    const publicacion = insertResult.rows[0]

    // 6. Invitacion para el comprador, si la cuenta es nueva.
    let tokenInvitacion: string | null = null
    if (compradorCuentaNueva) {
      tokenInvitacion = randomBytes(32).toString('hex')
      await client.query(
        `INSERT INTO invitaciones_cuenta (usuario_id, token_hash, expira_en) VALUES ($1, $2, $3)`,
        [compradorId, hashToken(tokenInvitacion), new Date(Date.now() + TOKEN_INVITACION_TTL_MS)]
      )
    }

    await client.query('COMMIT')

    // Best-effort, fuera de la transaccion: un fallo de envio no debe tumbar
    // el tramite ya creado -- el vendedor igual ve el link en su Garaje y se
    // lo puede pasar a mano.
    const linkPublicacion = `https://rodaid.net/marketplace/${publicacion.slug}`
    try {
      const reclamarUrl = tokenInvitacion
        ? `https://rodaid.net/reclamar-cuenta?token=${tokenInvitacion}`
        : null
      await enviarEmail({
        to: compradorEmail,
        subject: 'RODAID — Te invitaron a completar una compra con CIT Completo',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
          <h2>¡Hola ${input.compradorNombre}!</h2>
          <p>El vendedor con quien acordaste la compra de una bici inicio el tramite de CIT Completo en RODAID -- esto protege tu pago mientras <strong>${aliado.nombre}</strong> hace la verificacion tecnica de 20 puntos antes de la transferencia.</p>
          ${
            reclamarUrl
              ? `<p>Te creamos una cuenta -- <a href="${reclamarUrl}">hace click aca para elegir tu contrasena</a> y acceder a tu Garaje Digital.</p>`
              : ''
          }
          <p><a href="${linkPublicacion}">Ver la publicacion y reservar</a> cuando quieras confirmar.</p>
        </div>`,
      })
    } catch (err) {
      console.error('Error email acuerdo privado (comprador):', err)
    }
    try {
      await enviarEmail({
        to: aliado.email,
        subject: 'RODAID — Nueva verificacion de CIT Completo (acuerdo privado)',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
          <h2>Nueva verificacion pendiente</h2>
          <p>Un vendedor te eligio para certificar la venta de una bici que ya acordo con su comprador por fuera de RODAID -- funciona igual que cualquier CIT Completo: apenas el comprador pague la sena, la vas a ver en tu cola de inspecciones para correr la verificacion de 20 puntos.</p>
          <p>Entra a tu <a href="https://rodaid.net/taller">Panel de Taller Aliado</a> para hacer seguimiento.</p>
        </div>`,
      })
    } catch (err) {
      console.error('Error email acuerdo privado (taller):', err)
    }

    return {
      publicacionId: publicacion.id,
      slug: publicacion.slug,
      compradorId,
      compradorCuentaNueva,
      aliadoNombre: aliado.nombre,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
