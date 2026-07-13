import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  withTx,
  lockTransaccion,
  logEvento,
  type TransaccionRow,
} from '@/src/services/escrow.service'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'
import { registrarLiquidacionAliadoFeeLogistica } from '@/src/services/compensaciones.service'
import { firmarCanonico } from '@/src/services/acta-firma.service'
import { getBaseUrl } from '@/src/services/mercadopago.service'
import {
  generarRemitoPdf,
  guardarRemitoPdfEnBlobs,
  leerRemitoPdfDeBlobs,
  type RemitoDatos,
} from '@/src/services/pdf.service'

/**
 * RODAID — Remito de Embalaje y Despacho (Fase 6b, CIT Completo).
 *
 * Formaliza, con un documento PDF firmado, la orden de trabajo de embalaje
 * que el vendedor le da al Taller Aliado apenas se confirma el saldo de una
 * venta de CIT Completo. Dos actos distintos sobre la misma fila:
 *
 *   generarRemito()          -- el VENDEDOR dispara la orden (accion
 *                                explicita, nunca automatica: sin esto el
 *                                Taller no tiene forma de enterarse).
 *   confirmarDespachoRemito() -- el TALLER confirma que embalo y despacho,
 *                                firmado con su propia wallet_address (mismo
 *                                mecanismo que ya firma las actas de
 *                                inspeccion de 20 puntos) -- y dispara la
 *                                liquidacion del Fee de Logistica.
 *
 * No agrega ningun estado nuevo a escrow_transacciones.estado ni a
 * marketplace_publicaciones.estado: vive DENTRO de FONDOS_RETENIDOS /
 * EJECUTANDO_LOGISTICA. remitos.estado (GENERADO/DESPACHADO) es la unica
 * fuente de verdad de este sub-tramo (ver el comentario de la maquina de
 * estados al inicio de escrow.service.ts, seccion "Fase 6b").
 */

export type RemitoEstado = 'GENERADO' | 'DESPACHADO'

interface RemitoRow {
  id: string
  numero: string
  transaccion_id: string
  aliado_id: string
  vendedor_id: string
  estado: RemitoEstado
  pdf_documento_hash: string
  generado_en: string
  despachado_en: string | null
  firmado_por: string | null
  firma_wallet: string | null
  firma_hash: string | null
  firma_algoritmo: string | null
  firma_valor: string | null
  firma_certificado: string | null
  firma_cert_serie: string | null
  firma_cert_fingerprint: string | null
  firma_modo: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface RemitoMapeado {
  id: string
  numero: string
  transaccionId: string
  aliadoId: string
  vendedorId: string
  estado: RemitoEstado
  pdfDocumentoHash: string
  generadoEn: string
  despachadoEn: string | null
  firmadoPor: string | null
  firmaWallet: string | null
  firmaAlgoritmo: string | null
  firmaModo: string | null
}

function mapRemito(row: RemitoRow): RemitoMapeado {
  return {
    id: row.id,
    numero: row.numero,
    transaccionId: row.transaccion_id,
    aliadoId: row.aliado_id,
    vendedorId: row.vendedor_id,
    estado: row.estado,
    pdfDocumentoHash: row.pdf_documento_hash,
    generadoEn: row.generado_en,
    despachadoEn: row.despachado_en,
    firmadoPor: row.firmado_por,
    firmaWallet: row.firma_wallet,
    firmaAlgoritmo: row.firma_algoritmo,
    firmaModo: row.firma_modo,
  }
}

/** URL absoluta del Verificador Publico de Remitos (destino del QR). */
function verifierUrlRemito(numero: string): string {
  return `${getBaseUrl()}/verificar/remito/${encodeURIComponent(numero)}`
}

async function siguienteNumeroRemito(client: DbClient): Promise<string> {
  const res = await client.query<{ n: string }>(`SELECT nextval('remitos_numero_seq') AS n`)
  const n = res.rows[0]?.n ?? '0'
  const anio = new Date().getUTCFullYear()
  return `REM-${anio}-${n.padStart(6, '0')}`
}

interface DatosRemitoRow {
  marca: string
  modelo: string
  tipo: string
  numero_serie: string
  anio: number | null
  color: string | null
  rodado: string | null
  talle_cuadro: string | null
  codigo_cit: string
  vendedor_perfil: Record<string, unknown> | null
  vendedor_email: string
  taller_nombre: string
  taller_direccion: string | null
  taller_ciudad: string | null
  taller_telefono: string | null
  taller_usuario_id: string | null
  taller_email: string
}

/** Arma los datos de negocio del PDF (bici, vendedor, taller) desde la transaccion ya bloqueada. */
async function cargarDatosRemito(
  client: DbClient,
  tx: TransaccionRow
): Promise<{
  pdfDatos: Omit<RemitoDatos, 'numero' | 'verifierUrl'>
  tallerUsuarioId: string | null
  tallerEmail: string
}> {
  const res = await client.query<DatosRemitoRow>(
    `
      SELECT
        b.marca, b.modelo, b.tipo, b.numero_serie, b.anio, b.color, b.rodado, b.talle_cuadro,
        c.codigo_cit,
        v.datos_perfil AS vendedor_perfil, v.email AS vendedor_email,
        al.nombre AS taller_nombre, al.direccion AS taller_direccion, al.ciudad AS taller_ciudad,
        al.telefono AS taller_telefono, al.usuario_id AS taller_usuario_id, al.email AS taller_email
      FROM marketplace_publicaciones mp
      JOIN bicicletas b ON b.id = mp.bicicleta_id
      JOIN cits c ON c.id = mp.cit_id
      JOIN usuarios v ON v.id = $2
      JOIN aliados al ON al.id = $3
      WHERE mp.id = $1
      LIMIT 1
    `,
    [tx.publicacion_id, tx.vendedor_id, tx.aliado_id]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'DATOS_REMITO_NOT_FOUND', 'No pudimos armar los datos del remito.')
  }
  const perfil = row.vendedor_perfil ?? {}
  const vendedorNombre =
    (typeof perfil.nombre === 'string' && perfil.nombre.trim()) || row.vendedor_email

  return {
    pdfDatos: {
      codigoCit: row.codigo_cit,
      bici: {
        marca: row.marca,
        modelo: row.modelo,
        tipo: row.tipo,
        numeroSerie: row.numero_serie,
        anio: row.anio,
        color: row.color,
        rodado: row.rodado === null ? null : Number(row.rodado),
        talleCuadro: row.talle_cuadro,
      },
      vendedor: { nombre: vendedorNombre, contacto: row.vendedor_email },
      taller: {
        nombre: row.taller_nombre,
        direccion: row.taller_direccion,
        ciudad: row.taller_ciudad,
        telefono: row.taller_telefono,
      },
    },
    tallerUsuarioId: row.taller_usuario_id,
    tallerEmail: row.taller_email,
  }
}

// ── 1. generarRemito (vendedor, accion explicita) ───────────────────────────

export interface RemitoGenerado {
  remito: RemitoMapeado
  pdf: Uint8Array
  /** usuario_id del Taller (null si el aliado no vinculo cuenta) + su email, para notificar. */
  tallerUsuarioId: string | null
  tallerEmail: string
}

export async function generarRemito(input: {
  transaccionId: string
  vendedorId: string
}): Promise<RemitoGenerado> {
  return withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    if (tx.vendedor_id !== input.vendedorId) {
      throw new ApiError(403, 'NOT_SELLER', 'Este remito no corresponde a una venta tuya.')
    }
    if (!tx.aliado_id) {
      throw new ApiError(
        409,
        'NO_ES_CIT_COMPLETO',
        'Esta operacion no corresponde al flujo de CIT Completo.'
      )
    }
    if (tx.estado !== 'FONDOS_RETENIDOS') {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'El remito solo se genera con el saldo confirmado.'
      )
    }

    const existente = await client.query<{ id: string }>(
      `SELECT id FROM remitos WHERE transaccion_id = $1 LIMIT 1`,
      [tx.id]
    )
    if (existente.rows[0]) {
      throw new ApiError(409, 'REMITO_YA_GENERADO', 'Ya generaste el remito de esta venta.')
    }

    const { pdfDatos, tallerUsuarioId, tallerEmail } = await cargarDatosRemito(client, tx)
    const numero = await siguienteNumeroRemito(client)

    const pdfGenerado = await generarRemitoPdf({
      ...pdfDatos,
      numero,
      verifierUrl: verifierUrlRemito(numero),
    })

    await guardarRemitoPdfEnBlobs(numero, pdfGenerado.pdf)

    const inserted = await client.query<RemitoRow>(
      `
        INSERT INTO remitos
          (numero, transaccion_id, aliado_id, vendedor_id, pdf_documento_hash)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [numero, tx.id, tx.aliado_id, tx.vendedor_id, pdfGenerado.documentoHash]
    )

    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'REMITO_GENERADO',
      actorId: input.vendedorId,
      actorRol: 'vendedor',
      metadata: { numero },
    })

    return {
      remito: mapRemito(inserted.rows[0]),
      pdf: pdfGenerado.pdf,
      tallerUsuarioId,
      tallerEmail,
    }
  })
  // NOTA: la notificacion al Taller (in-app + email) se dispara desde el
  // endpoint que llama a esta funcion, una vez confirmada la transaccion --
  // requiere los valores REMITO_GENERADO/REMITO_RECORDATORIO/REMITO_DESPACHADO
  // de notif_tipo (20260712000002_notif_tipo_remitos.sql), que tiene que estar
  // `ready` en produccion antes de que ese codigo se mergee (ver el comentario
  // de esa migracion). Pieza siguiente, no de esta.
}

// ── 2. confirmarDespachoRemito (Taller, firma con su wallet) ────────────────

interface RemitoDespachoPayload {
  numero: string
  transaccionId: string
  aliadoId: string
  firmadoPorId: string
  walletAddress: string
  despachadoEn: string
}

/** Serializacion canonica y estable (claves ordenadas) -- exactamente el texto que se firma. */
function canonicalizarDespachoRemito(p: RemitoDespachoPayload): string {
  return JSON.stringify({
    aliadoId: p.aliadoId,
    despachadoEn: p.despachadoEn,
    firmadoPorId: p.firmadoPorId,
    numero: p.numero,
    transaccionId: p.transaccionId,
    walletAddress: p.walletAddress,
  })
}

export interface RemitoDespachado {
  remito: RemitoMapeado
  transaccionId: string
  compradorId: string
}

export async function confirmarDespachoRemito(input: {
  numero: string
  actorId: string
}): Promise<RemitoDespachado> {
  return withTx(async (client) => {
    const res = await client.query<RemitoRow>(
      `SELECT * FROM remitos WHERE numero = $1 FOR UPDATE`,
      [input.numero]
    )
    const remito = res.rows[0]
    if (!remito) {
      throw new ApiError(404, 'REMITO_NOT_FOUND', 'El remito no existe.')
    }
    if (remito.estado !== 'GENERADO') {
      throw new ApiError(409, 'REMITO_YA_DESPACHADO', 'Este remito ya fue despachado.')
    }

    // Ownership ESTRICTO -- mismo resolver que aprobarInspeccion/reportarDiscrepancia
    // en inspeccion.service.ts. Deliberado: NUNCA resolverAliadoParaLectura() aca --
    // un admin en modo "ver como" (Admin View-As) no puede despachar en nombre de
    // un Taller real, porque este resolver ignora por completo cualquier
    // impersonacion y exige usuario_id real vinculado al aliado.
    const aliado = await resolverAliadoDeUsuario(input.actorId)
    if (!aliado || aliado.id !== remito.aliado_id) {
      throw new ApiError(
        403,
        'NOT_ALIADO_OWNER',
        'Este remito no pertenece a tu Taller Aliado.'
      )
    }

    const walletRes = await client.query<{ wallet_address: string | null }>(
      `SELECT wallet_address FROM usuarios WHERE id = $1`,
      [input.actorId]
    )
    const walletAddress = walletRes.rows[0]?.wallet_address
    if (!walletAddress) {
      throw new ApiError(
        409,
        'SIN_WALLET',
        'Configura tu identidad digital (wallet) antes de firmar el despacho.'
      )
    }

    const tx = await lockTransaccion(client, remito.transaccion_id)

    const despachadoEn = new Date().toISOString()
    const payload: RemitoDespachoPayload = {
      numero: remito.numero,
      transaccionId: remito.transaccion_id,
      aliadoId: remito.aliado_id,
      firmadoPorId: input.actorId,
      walletAddress,
      despachadoEn,
    }
    const canonico = canonicalizarDespachoRemito(payload)
    const firma = await firmarCanonico(canonico)

    const actualizado = await client.query<RemitoRow>(
      `
        UPDATE remitos
        SET estado = 'DESPACHADO',
            despachado_en = $2,
            firmado_por = $3,
            firma_wallet = $4,
            firma_hash = $5,
            firma_algoritmo = $6,
            firma_valor = $7,
            firma_certificado = $8,
            firma_cert_serie = $9,
            firma_cert_fingerprint = $10,
            firma_modo = $11
        WHERE id = $1
        RETURNING *
      `,
      [
        remito.id,
        despachadoEn,
        input.actorId,
        walletAddress,
        canonico,
        firma.algoritmo,
        firma.valor,
        firma.certificadoPem,
        firma.certSerie,
        firma.certFingerprint,
        firma.modo,
      ]
    )

    // El Taller cobra el embalaje AHORA -- por el trabajo que efectivamente
    // hizo, sin depender de que el comprador confirme la entrega final dias
    // despues (ver compensaciones.service.ts y el comentario de la maquina de
    // estados en escrow.service.ts).
    await registrarLiquidacionAliadoFeeLogistica(client, {
      transaccionId: tx.id,
      aliadoId: remito.aliado_id,
      monto: Number(tx.fee_logistica_pagado_taller_ars),
    })

    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'REMITO_DESPACHADO',
      actorId: input.actorId,
      actorRol: 'aliado',
      metadata: { numero: remito.numero, firmaAlgoritmo: firma.algoritmo, firmaModo: firma.modo },
    })

    return {
      remito: mapRemito(actualizado.rows[0]),
      transaccionId: tx.id,
      compradorId: tx.comprador_id,
    }
  })
  // NOTA: notificacion al comprador ("tu bici fue despachada") -- misma
  // dependencia de notif_tipo que generarRemito(), pieza siguiente.
}

// ── 3. Lecturas ──────────────────────────────────────────────────────────────

/** Remito de una transaccion, si ya se genero. Usado por el frontend del vendedor/comprador. */
export async function obtenerRemitoPorTransaccion(
  transaccionId: string
): Promise<RemitoMapeado | null> {
  const res = await getPool().query<RemitoRow>(
    `SELECT * FROM remitos WHERE transaccion_id = $1 LIMIT 1`,
    [transaccionId]
  )
  return res.rows[0] ? mapRemito(res.rows[0]) : null
}

/** Remito por numero (descarga del PDF, panel del Taller, verificador publico). */
export async function obtenerRemitoPorNumero(numero: string): Promise<RemitoMapeado | null> {
  const res = await getPool().query<RemitoRow>(
    `SELECT * FROM remitos WHERE numero = $1 LIMIT 1`,
    [numero]
  )
  return res.rows[0] ? mapRemito(res.rows[0]) : null
}

export interface RemitoListado extends RemitoMapeado {
  bici: { marca: string; modelo: string; numeroSerie: string }
  codigoCit: string
}

interface RemitoListadoRow extends RemitoRow {
  marca: string
  modelo: string
  numero_serie: string
  codigo_cit: string
}

/**
 * Remitos de un Taller Aliado (pendientes de despacho primero), con los
 * datos minimos de la bici para que el staff identifique cual es cual --
 * usada por el panel de despacho (GET /api/v1/talleres/remitos).
 */
export async function listarRemitosPorAliado(aliadoId: string): Promise<RemitoListado[]> {
  const res = await getPool().query<RemitoListadoRow>(
    `
      SELECT r.*, b.marca, b.modelo, b.numero_serie, c.codigo_cit
      FROM remitos r
      JOIN escrow_transacciones tx ON tx.id = r.transaccion_id
      JOIN marketplace_publicaciones mp ON mp.id = tx.publicacion_id
      JOIN bicicletas b ON b.id = mp.bicicleta_id
      JOIN cits c ON c.id = mp.cit_id
      WHERE r.aliado_id = $1
      ORDER BY (r.estado = 'GENERADO') DESC, r.generado_en DESC
      LIMIT 100
    `,
    [aliadoId]
  )
  return res.rows.map((row: RemitoListadoRow) => ({
    ...mapRemito(row),
    bici: { marca: row.marca, modelo: row.modelo, numeroSerie: row.numero_serie },
    codigoCit: row.codigo_cit,
  }))
}

/** Bytes del PDF ya generado (inmutable, no se regenera). */
export async function obtenerRemitoPdf(numero: string): Promise<Uint8Array | null> {
  return leerRemitoPdfDeBlobs(numero)
}

// ── 4. Verificador Publico ───────────────────────────────────────────────────

export interface RemitoVerificacionPublica {
  numero: string
  estado: RemitoEstado
  generadoEn: string
  despachadoEn: string | null
  bici: { marca: string; modelo: string; tipo: string }
  codigoCit: string
}

interface VerificacionRemitoRow {
  numero: string
  estado: RemitoEstado
  generado_en: string
  despachado_en: string | null
  marca: string
  modelo: string
  tipo: string
  codigo_cit: string
}

/**
 * Datos publicos de verificacion de un remito -- para /api/v1/verificar/remito/:numero.
 * Deliberadamente NO incluye vendedor, taller ni comprador: esos datos SI
 * viajan impresos en el PDF (que solo llega a las partes por canales
 * autenticados), pero la respuesta publica es mas conservadora, mismo
 * criterio que el Verificador Publico de bicis (nunca expone datos
 * personales del propietario).
 */
export async function obtenerVerificacionPublicaRemito(
  numero: string
): Promise<RemitoVerificacionPublica | null> {
  const res = await getPool().query<VerificacionRemitoRow>(
    `
      SELECT
        r.numero, r.estado, r.generado_en, r.despachado_en,
        b.marca, b.modelo, b.tipo, c.codigo_cit
      FROM remitos r
      JOIN escrow_transacciones tx ON tx.id = r.transaccion_id
      JOIN marketplace_publicaciones mp ON mp.id = tx.publicacion_id
      JOIN bicicletas b ON b.id = mp.bicicleta_id
      JOIN cits c ON c.id = mp.cit_id
      WHERE r.numero = $1
      LIMIT 1
    `,
    [numero]
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    numero: row.numero,
    estado: row.estado,
    generadoEn: row.generado_en,
    despachadoEn: row.despachado_en,
    bici: { marca: row.marca, modelo: row.modelo, tipo: row.tipo },
    codigoCit: row.codigo_cit,
  }
}
