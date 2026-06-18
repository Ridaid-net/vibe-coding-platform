// ─── RODAID · Transferencia de Dominio ───────────────────
//
// Cuando una bicicleta se vende en el marketplace RODAID,
// el sistema emite un CERTIFICADO DE TRANSFERENCIA DE DOMINIO
// que acredita el cambio formal de titular de la unidad.
//
// ══ FLUJO ════════════════════════════════════════════════
//
//  Escrow COMPLETADA (confirmarEntrega o auto-release)
//      │
//      ▼
//  iniciarTransferenciaDominio()
//      │
//      ├─ 1. Genera N° transferencia TROD-YYYYMM-XXXXX
//      ├─ 2. Bloquea el CIT del vendedor (estado TRANSFERIDO)
//      ├─ 3. Transfiere el NFT ERC-721 en BFA
//      │     bfaService.transferirCIT(tokenId, walletAdquirente)
//      ├─ 4. Actualiza bicicletas.propietario_id → comprador
//      ├─ 5. Crea nuevo CIT en nombre del comprador
//      │     heredando el SHA-256 original (inmutable)
//      ├─ 6. Emite el Certificado de Transferencia de Dominio
//      ├─ 7. Notifica cedente + adquirente (Push + Email + In-App)
//      └─ 8. Estado: COMPLETADA
//
// ══ NUMERACIÓN ═══════════════════════════════════════════
//
//   TROD-YYYYMM-XXXXX
//   TROD = Transferencia de Dominio RODAID
//   YYYYMM = año y mes (202606)
//   XXXXX = secuencia DB incremental (00001, 00002, ...)
//
// ══ CERTIFICADO ══════════════════════════════════════════
//
//   El certificado contiene:
//   • Número de transferencia
//   • Cedente (vendedor): nombre, apellido, identidad MxM
//   • Adquirente (comprador): nombre, apellido, identidad MxM
//   • Datos de la unidad: marca, modelo, número de serie
//   • CIT de origen (vendedor) y CIT de destino (comprador)
//   • SHA-256 inmutable del CIT (verifica la integridad)
//   • NFT token ID + TX hash de la transferencia en BFA
//   • Precio de la transacción
//   • Fecha y hora UTC con timezone Mendoza (GMT-3)
//   • QR apuntando a /verificar/:serial (nuevo propietario)
//   • Firma digital RODAID

import crypto                from 'crypto'
import { log }               from '../middleware/logger'
import { query, queryOne }   from '../config/database'
import { bfaService }        from './bfa.service'
import { generarHashCIT }    from './cit.hash'
import { getRedis }          from '../config/redis'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface TransferenciaDominioInput {
  transaccionId:  string
  citId:          string      // CIT activo del vendedor
  vendedorId:     string
  compradorId:    string
  precioArs:      number
  comisionArs?:   number
  ip?:            string
}

export interface TransferenciaDominioResult {
  ok:                    boolean
  transferenciaId:       string
  numeroTransferencia:   string
  estadoFinal:           string
  bfaTxHash:             string | null
  numeroCITNuevo:        string | null
  citNuevoId:            string | null
  error?:                string
}

export interface DatosCertificado {
  // Identificación
  numeroTransferencia:   string
  fecha:                 string    // ISO + timezone Mendoza
  fechaLegible:          string    // "16 de junio de 2026 · 14:35 ART"

  // Cedente (vendedor)
  cedente: {
    nombre:   string
    apellido: string
    email:    string
    mxmNivel: number | null
  }

  // Adquirente (comprador)
  adquirente: {
    nombre:   string
    apellido: string
    email:    string
    mxmNivel: number | null
  }

  // Unidad transferida
  bicicleta: {
    marca:       string
    modelo:      string
    tipo:        string
    anio:        number | null
    color:       string | null
    numeroSerie: string
  }

  // CITs
  citCedente: {
    numeroCIT:   string
    puntos:      number
    hashSHA256:  string
    nftTokenId:  number | null
    fechaEmision: string | null
  }
  citAdquirente: {
    numeroCIT:   string | null
    nftTokenId:  number | null
  } | null

  // Blockchain
  bfaTxHashTransfer: string | null
  walletCedente:     string | null
  walletAdquirente:  string | null

  // Económico
  precioArs:         number
  comisionRodaidArs: number

  // Verificación
  qrUrl:             string
  certificadoHash:   string | null
}

// ══════════════════════════════════════════════════════════
// GENERAR NÚMERO DE TRANSFERENCIA
// ══════════════════════════════════════════════════════════

async function generarNumeroTransferencia(): Promise<string> {
  const seq = await queryOne<{ nextval: string }>(
    `SELECT nextval('transferencia_dominio_seq')::text AS nextval`, []
  )
  const n       = parseInt(seq?.nextval ?? '1')
  const ahora   = new Date()
  const yyyymm  = ahora.getFullYear().toString() +
                  String(ahora.getMonth() + 1).padStart(2, '0')
  const seqStr  = String(n).padStart(5, '0')
  return `TROD-${yyyymm}-${seqStr}`
}

// ══════════════════════════════════════════════════════════
// CREAR NUEVO CIT PARA EL ADQUIRENTE
// Hereda el SHA-256 inmutable — solo cambia el propietario
// ══════════════════════════════════════════════════════════

async function emitirCITAdquirente(opts: {
  bicicletaId:  string
  compradorId:  string
  inspectorId:  string | null
  tallerAlidoId: string | null
  puntosTotal:  number
  hashSHA256:   string
  nftTokenId:   number | null
  bfaTxHash:    string | null
  numeroCITCedente: string
}): Promise<{ citId: string; numeroCIT: string }> {
  // Número CIT del adquirente: agrega sufijo /T al número original
  // Ej: RCIT-2026-00039 → RCIT-2026-00039/T1
  const baseNum = opts.numeroCITCedente.replace(/\/T\d+$/, '')
  const existing = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM cits WHERE numero_cit LIKE $1`,
    [baseNum + '/T%']
  )
  const rev = parseInt(existing?.count ?? '0') + 1
  const numeroCIT = `${baseNum}/T${rev}`

  const citId = crypto.randomUUID()
  await query(
    `INSERT INTO cits
       (id, numero_cit, bicicleta_id, propietario_id, inspector_id, taller_aliado_id,
        estado, puntos_total, hash_sha256, hash_version,
        nft_token_id, bfa_tx_hash, mint_estado, mint_completado_en,
        tasa_pagada, fecha_emision, fecha_vencimiento,
        dj_firmada, dj_firmada_en)
     VALUES
       ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,
        'ACTIVO',$7,$8,2,
        $9,$10,'COMPLETADO',NOW(),
        TRUE,NOW(),NOW()+INTERVAL '1 year',
        TRUE,NOW())`,
    [
      citId, numeroCIT, opts.bicicletaId, opts.compradorId,
      opts.inspectorId, opts.tallerAlidoId,
      opts.puntosTotal, opts.hashSHA256,
      opts.nftTokenId, opts.bfaTxHash,
    ]
  )

  log.bfa.info({ citId, numeroCIT }, '✓ CIT adquirente emitido')
  return { citId, numeroCIT }
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function iniciarTransferenciaDominio(
  opts: TransferenciaDominioInput
): Promise<TransferenciaDominioResult> {

  // Idempotencia: una transacción solo genera una transferencia
  const yaExiste = await queryOne<{ id: string; numero_transferencia: string; estado: string }>(
    `SELECT id::text, numero_transferencia, estado
     FROM transferencias_dominio WHERE transaccion_id = $1::uuid`,
    [opts.transaccionId]
  )
  if (yaExiste) {
    log.bfa.warn({ transferenciaId: yaExiste.id }, '⚡ Transferencia ya iniciada (idempotente)')
    return {
      ok: true,
      transferenciaId:      yaExiste.id,
      numeroTransferencia:  yaExiste.numero_transferencia,
      estadoFinal:          yaExiste.estado,
      bfaTxHash:            null,
      numeroCITNuevo:       null,
      citNuevoId:           null,
    }
  }

  // ── 1. Cargar datos del CIT del vendedor ──────────────
  const citVendedor = await queryOne<{
    id: string; numero_cit: string; bicicleta_id: string
    puntos_total: number; hash_sha256: string
    nft_token_id: number | null; bfa_tx_hash: string | null
    marca: string; modelo: string; numero_serie: string
    tipo: string; anio: number | null; color: string | null
    propietario_wallet: string | null
    inspector_id: string | null; taller_aliado_id: string | null
  }>(`
    SELECT c.id::text, c.numero_cit, c.bicicleta_id::text,
           c.puntos_total, c.hash_sha256, c.nft_token_id, c.bfa_tx_hash,
           b.marca, b.modelo, b.numero_serie, b.tipo, b.anio, b.color,
           b.wallet_address AS propietario_wallet,
           c.inspector_id::text, c.taller_aliado_id::text
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    WHERE c.id = $1::uuid AND c.estado = 'ACTIVO'
  `, [opts.citId])

  if (!citVendedor) {
    throw Object.assign(
      new Error(`CIT ${opts.citId} no encontrado o no está ACTIVO`),
      { code: 'CIT_NOT_FOUND', status: 404 }
    )
  }

  // ── 2. Cargar wallets de ambas partes ─────────────────
  const [compradorWalletRow, vendedorNombre, compradorNombre] = await Promise.all([
    queryOne<{ wallet_address: string | null }>(
      `SELECT wallet_address FROM bicicletas WHERE propietario_id=$1::uuid LIMIT 1`,
      [opts.compradorId]
    ),
    queryOne<{ nombre: string; apellido: string }>(
      `SELECT nombre, apellido FROM usuarios WHERE id=$1::uuid`, [opts.vendedorId]
    ),
    queryOne<{ nombre: string; apellido: string }>(
      `SELECT nombre, apellido FROM usuarios WHERE id=$1::uuid`, [opts.compradorId]
    ),
  ])

  const walletAdquirente = compradorWalletRow?.wallet_address
    ?? process.env.RODAID_CUSTODIAL_WALLET
    ?? '0x0000000000000000000000000000000000000000'
  const walletCedente    = citVendedor.propietario_wallet
    ?? process.env.RODAID_CUSTODIAL_WALLET
    ?? '0x0000000000000000000000000000000000000000'

  // ── 3. Crear registro inicial en DB ───────────────────
  const numeroTransferencia = await generarNumeroTransferencia()
  const transferenciaId     = crypto.randomUUID()

  await query(
    `INSERT INTO transferencias_dominio
       (id, numero_transferencia, cedente_id, adquirente_id,
        bicicleta_id, numero_serie, cit_cedente_id, numero_cit_cedente,
        hash_sha256, nft_token_id, bfa_tx_hash_mint,
        wallet_cedente, wallet_adquirente,
        transaccion_id, precio_ars, comision_rodaid_ars,
        estado, ip_origen, iniciada_en)
     VALUES
       ($1::uuid,$2,$3::uuid,$4::uuid,
        $5::uuid,$6,$7::uuid,$8,
        $9,$10,$11,
        $12,$13,
        $14::uuid,$15,$16,
        'INICIADA',$17::inet,NOW())`,
    [
      transferenciaId, numeroTransferencia, opts.vendedorId, opts.compradorId,
      citVendedor.bicicleta_id, citVendedor.numero_serie,
      citVendedor.id, citVendedor.numero_cit,
      citVendedor.hash_sha256, citVendedor.nft_token_id, citVendedor.bfa_tx_hash,
      walletCedente, walletAdquirente,
      opts.transaccionId, opts.precioArs, opts.comisionArs ?? 0,
      opts.ip ?? null,
    ]
  )

  log.bfa.info({
    transferenciaId, numeroTransferencia,
    cedente:    `${vendedorNombre?.nombre} ${vendedorNombre?.apellido}`,
    adquirente: `${compradorNombre?.nombre} ${compradorNombre?.apellido}`,
    bici:       `${citVendedor.marca} ${citVendedor.modelo} (${citVendedor.numero_serie})`,
    nft:        citVendedor.nft_token_id,
  }, '🔄 Transferencia de dominio iniciada')

  // ── 4. Bloquear CIT del cedente ───────────────────────
  await query(
    `UPDATE cits SET estado='TRANSFERIDO', actualizado_en=NOW() WHERE id=$1::uuid`,
    [citVendedor.id]
  )

  // ── 5. Transferir NFT en BFA ──────────────────────────
  let bfaTxHash: string | null = null
  if (citVendedor.nft_token_id) {
    try {
      bfaTxHash = await bfaService.transferirCIT(
        citVendedor.nft_token_id,
        walletAdquirente
      )
      await query(
        `UPDATE transferencias_dominio
         SET estado='BFA_COMPLETADA', bfa_tx_hash_transfer=$2, bfa_transferida_en=NOW()
         WHERE id=$1::uuid`,
        [transferenciaId, bfaTxHash]
      )
      log.bfa.info({
        tokenId: citVendedor.nft_token_id, bfaTxHash: bfaTxHash?.slice(0, 25),
      }, '⛓ NFT transferido en BFA')
    } catch (err) {
      log.bfa.error({ err: (err as Error).message }, '⚠ BFA transfer falló — continúa sin NFT')
      await query(
        `UPDATE transferencias_dominio SET estado='BFA_PENDIENTE' WHERE id=$1::uuid`,
        [transferenciaId]
      )
    }
  }

  // ── 6. Actualizar propietario de la bicicleta en DB ───
  await query(
    `UPDATE bicicletas SET propietario_id=$2::uuid, actualizado_en=NOW() WHERE id=$1::uuid`,
    [citVendedor.bicicleta_id, opts.compradorId]
  )

  // ── 7. Emitir nuevo CIT en nombre del adquirente ──────
  const { citId: citNuevoId, numeroCIT: numeroCITNuevo } = await emitirCITAdquirente({
    bicicletaId:      citVendedor.bicicleta_id,
    compradorId:      opts.compradorId,
    inspectorId:      citVendedor.inspector_id,
    tallerAlidoId:    citVendedor.taller_aliado_id,
    puntosTotal:      citVendedor.puntos_total,
    hashSHA256:       citVendedor.hash_sha256,   // SHA-256 INMUTABLE
    nftTokenId:       citVendedor.nft_token_id,
    bfaTxHash:        bfaTxHash ?? citVendedor.bfa_tx_hash,
    numeroCITCedente: citVendedor.numero_cit,
  })

  // ── 8. Calcular hash del certificado ──────────────────
  const certPayload = JSON.stringify({
    numeroTransferencia, citCedente: citVendedor.numero_cit,
    citAdquirente: numeroCITNuevo, nft: citVendedor.nft_token_id,
    hash: citVendedor.hash_sha256, tx: bfaTxHash,
    ts: new Date().toISOString(),
  })
  const certificadoHash = crypto.createHash('sha256').update(certPayload, 'utf8').digest('hex')

  // ── 9. Actualizar registro final ──────────────────────
  await query(
    `UPDATE transferencias_dominio SET
       estado='COMPLETADA',
       cit_adquirente_id   = $2::uuid,
       numero_cit_adquirente = $3,
       bfa_tx_hash_transfer  = COALESCE(bfa_tx_hash_transfer, $4),
       certificado_hash    = $5,
       cit_emitido_en      = NOW(),
       completada_en       = NOW()
     WHERE id = $1::uuid`,
    [transferenciaId, citNuevoId, numeroCITNuevo, bfaTxHash, certificadoHash]
  )

  // ── 10. Notificar ambas partes ─────────────────────────
  const { notificar } = await import('./notif.service')
  await Promise.allSettled([
    // Notificación al vendedor (cedente)
    notificar({
      usuarioId: opts.vendedorId,
      tipo:      'VENTA_CONFIRMADA',
      titulo:    `🔄 Dominio transferido — ${citVendedor.numero_serie}`,
      cuerpo:    `La bicicleta ${citVendedor.marca} ${citVendedor.modelo} fue transferida a ${compradorNombre?.nombre} ${compradorNombre?.apellido}. N° Transferencia: ${numeroTransferencia}. Tu CIT (${citVendedor.numero_cit}) queda registrado como cedente.`,
      datos:     { transferenciaId, numeroTransferencia, tipo: 'CEDENTE' },
    }),
    // Notificación al comprador (adquirente)
    notificar({
      usuarioId: opts.compradorId,
      tipo:      'CIT_APROBADO',
      titulo:    `✅ ¡Bicicleta registrada a tu nombre! ${numeroCITNuevo}`,
      cuerpo:    `La ${citVendedor.marca} ${citVendedor.modelo} (${citVendedor.numero_serie}) fue transferida a tu nombre. Tu CIT: ${numeroCITNuevo}. N° Transferencia de Dominio: ${numeroTransferencia}.`,
      datos:     { transferenciaId, numeroTransferencia, citId: citNuevoId, tipo: 'ADQUIRENTE' },
    }),
  ])

  log.bfa.info({
    transferenciaId, numeroTransferencia,
    citNuevoId, numeroCITNuevo,
    bfaTxHash: bfaTxHash?.slice(0, 25),
    certificadoHash: certificadoHash.slice(0, 16),
  }, `✅ Transferencia de dominio COMPLETADA`)

  return {
    ok:                   true,
    transferenciaId,
    numeroTransferencia,
    estadoFinal:          'COMPLETADA',
    bfaTxHash,
    numeroCITNuevo,
    citNuevoId,
  }
}

// ══════════════════════════════════════════════════════════
// CARGAR DATOS DEL CERTIFICADO (para PDF y vista)
// ══════════════════════════════════════════════════════════

export async function getDatosCertificado(
  transferenciaId: string
): Promise<DatosCertificado | null> {
  const td = await queryOne<any>(`
    SELECT
      td.numero_transferencia, td.hash_sha256, td.nft_token_id,
      td.bfa_tx_hash_mint, td.bfa_tx_hash_transfer,
      td.wallet_cedente, td.wallet_adquirente,
      td.precio_ars, td.comision_rodaid_ars,
      td.certificado_hash, td.completada_en,
      -- Cedente
      uc.nombre   AS cedente_nombre,   uc.apellido AS cedente_apellido,
      uc.email    AS cedente_email,    uc.mxm_nivel_verificacion AS cedente_mxm,
      -- Adquirente
      ua.nombre   AS adq_nombre,       ua.apellido AS adq_apellido,
      ua.email    AS adq_email,        ua.mxm_nivel_verificacion AS adq_mxm,
      -- Bicicleta
      b.marca, b.modelo, b.tipo, b.anio, b.color, b.numero_serie,
      -- CIT cedente
      cc.numero_cit AS cit_cedente_num, cc.puntos_total AS cit_cedente_pts,
      cc.fecha_emision AS cit_cedente_emision,
      -- CIT adquirente
      ca.numero_cit AS cit_adq_num
    FROM transferencias_dominio td
    JOIN usuarios  uc ON uc.id = td.cedente_id
    JOIN usuarios  ua ON ua.id = td.adquirente_id
    JOIN bicicletas b ON b.id  = td.bicicleta_id
    LEFT JOIN cits cc ON cc.id = td.cit_cedente_id
    LEFT JOIN cits ca ON ca.id = td.cit_adquirente_id
    WHERE td.id::text = $1
       OR td.numero_transferencia = $1
  `, [transferenciaId])

  if (!td) return null

  const fecha = new Date(td.completada_en ?? new Date())
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre']
  const fechaLegible = `${fecha.getUTCDate()} de ${meses[fecha.getUTCMonth()]} de ${fecha.getUTCFullYear()} · ${String(fecha.getUTCHours()-3).padStart(2,'0')}:${String(fecha.getUTCMinutes()).padStart(2,'0')} ART`

  return {
    numeroTransferencia:  td.numero_transferencia,
    fecha:                fecha.toISOString(),
    fechaLegible,
    cedente: {
      nombre:   td.cedente_nombre,
      apellido: td.cedente_apellido,
      email:    td.cedente_email,
      mxmNivel: td.cedente_mxm ?? null,
    },
    adquirente: {
      nombre:   td.adq_nombre,
      apellido: td.adq_apellido,
      email:    td.adq_email,
      mxmNivel: td.adq_mxm ?? null,
    },
    bicicleta: {
      marca:       td.marca,
      modelo:      td.modelo,
      tipo:        td.tipo,
      anio:        td.anio,
      color:       td.color,
      numeroSerie: td.numero_serie,
    },
    citCedente: {
      numeroCIT:    td.cit_cedente_num,
      puntos:       td.cit_cedente_pts ?? 0,
      hashSHA256:   td.hash_sha256,
      nftTokenId:   td.nft_token_id,
      fechaEmision: td.cit_cedente_emision?.toISOString().slice(0,10) ?? null,
    },
    citAdquirente: td.cit_adq_num ? {
      numeroCIT:  td.cit_adq_num,
      nftTokenId: td.nft_token_id,
    } : null,
    bfaTxHashTransfer: td.bfa_tx_hash_transfer ?? null,
    walletCedente:     td.wallet_cedente ?? null,
    walletAdquirente:  td.wallet_adquirente ?? null,
    precioArs:         parseFloat(td.precio_ars ?? 0),
    comisionRodaidArs: parseFloat(td.comision_rodaid_ars ?? 0),
    qrUrl:             `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.net'}/verificar/${td.numero_serie}`,
    certificadoHash:   td.certificado_hash ?? null,
  }
}

// ══════════════════════════════════════════════════════════
// HISTORIAL DE TRANSFERENCIAS DE UNA BICICLETA
// ══════════════════════════════════════════════════════════

export async function getHistorialDominio(
  bicicletaId: string
): Promise<Array<{
  numero:      string
  fecha:       string
  cedente:     string
  adquirente:  string
  precio:      number
  estado:      string
  nft:         number | null
  bfaTx:       string | null
}>> {
  const rows = await query<any>(`
    SELECT
      td.numero_transferencia AS numero,
      td.completada_en        AS fecha,
      uc.nombre || ' ' || uc.apellido AS cedente,
      ua.nombre || ' ' || ua.apellido AS adquirente,
      td.precio_ars           AS precio,
      td.estado,
      td.nft_token_id         AS nft,
      td.bfa_tx_hash_transfer AS bfa_tx
    FROM transferencias_dominio td
    JOIN usuarios uc ON uc.id = td.cedente_id
    JOIN usuarios ua ON ua.id = td.adquirente_id
    WHERE td.bicicleta_id = $1::uuid
    ORDER BY td.iniciada_en DESC
  `, [bicicletaId])

  return rows.map(r => ({
    numero:     r.numero,
    fecha:      r.fecha?.toISOString() ?? '',
    cedente:    r.cedente,
    adquirente: r.adquirente,
    precio:     parseFloat(r.precio ?? 0),
    estado:     r.estado,
    nft:        r.nft,
    bfaTx:      r.bfa_tx,
  }))
}
