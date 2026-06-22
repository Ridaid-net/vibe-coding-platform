"use strict";
// ─── RODAID · Estado Real del CIT ─────────────────────────
//
// Lógica de negocio para calcular el estado efectivo de un CIT.
// El campo `estado` en DB es el estado *base*, pero el estado
// *real* para el usuario puede diferir según:
//
//   ACTIVO  + fecha_vencimiento < HOY    → EXPIRADO
//   ACTIVO  + tasa_pagada=false          → ACTIVO_SIN_TASA   (pendiente de pago)
//   ACTIVO  + nft_token_id null          → ACTIVO_SIN_NFT    (mint pendiente)
//   ACTIVO  + todo OK                   → VIGENTE
//   BORRADOR + puntos_total < 16         → INSPECCION_INCOMPLETA
//   BORRADOR + puntos_total >= 16        → LISTO_PARA_PAGO
//
// Fuentes de verdad auditadas:
//   · cits table (estado base, hash, fechas, puntaje)
//   · cit_pagos_mxm (estado del pago de tasa)
//   · bicicletas (número de serie, marca, modelo)
//   · inspectores + usuarios (inspector que firmó)
//   · denuncias (alertas de robo activas)
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCITEstado = getCITEstado;
exports.getCITEstadoPorNumero = getCITEstadoPorNumero;
const database_1 = require("../config/database");
// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════
async function getCITEstado(idOrNumero // UUID o numero_cit como RCIT-2026-00041
) {
    // Buscar por UUID o por numero_cit
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumero);
    const row = await (0, database_1.queryOne)(`
    SELECT
      c.id::text, c.numero_cit, c.estado,
      c.tasa_pagada, c.hash_sha256, c.nft_token_id,
      c.fecha_emision::text, c.fecha_vencimiento::text,
      c.puntos_total, c.fotos_count,
      c.propietario_nombre, c.propietario_dni,
      c.motivo_rechazo,
      c.insp_geo_lat, c.insp_geo_lng,
      c.firma_payload_hash,
      c.creado_en::text, c.actualizado_en::text,
      c.mxm_expediente,
      -- Bicicleta
      b.id::text AS bici_id,
      b.numero_serie, b.marca, b.modelo,
      -- Propietario
      u.id::text AS prop_id, u.nombre AS prop_nombre, u.email AS prop_email,
      -- Inspector
      i.id::text AS insp_id,
      i.certificado AS insp_certificado,
      u_insp.nombre   AS insp_nombre,
      u_insp.apellido AS insp_apellido,
      -- Pago MxM más reciente
      p.mxm_pago_id, p.mxm_estado, p.monto_ars,
      p.mxm_expediente_id AS expediente_id,
      p.aprobado_en::text AS pago_aprobado_en,
      -- Denuncia activa
      d.motivo AS denuncia_motivo, d.estado AS denuncia_estado
    FROM cits c
    JOIN  bicicletas b  ON b.id = c.bicicleta_id
    JOIN  usuarios   u  ON u.id = c.propietario_id
    LEFT JOIN inspectores i      ON i.id = c.inspector_id
    LEFT JOIN usuarios    u_insp ON u_insp.id = i.usuario_id
    LEFT JOIN LATERAL (
      SELECT * FROM cit_pagos_mxm
      WHERE cit_id = c.id
      ORDER BY creado_en DESC LIMIT 1
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT descripcion AS motivo, estado FROM denuncias
      WHERE (cit_id = c.id OR numero_serie = b.numero_serie)
        AND estado = 'ABIERTA'
      ORDER BY creado_en DESC LIMIT 1
    ) d ON TRUE
    WHERE ${isUUID ? 'c.id = $1::uuid' : "c.numero_cit = $1"}
  `, [idOrNumero]);
    if (!row)
        return null;
    // ── Calcular estado efectivo ────────────────────────────
    const hoy = new Date();
    const vencimiento = row.fecha_vencimiento ? new Date(row.fecha_vencimiento) : null;
    const diasVigencia = vencimiento
        ? Math.ceil((vencimiento.getTime() - hoy.getTime()) / 86_400_000)
        : null;
    const expirado = vencimiento ? vencimiento < hoy : false;
    const vencePronto = diasVigencia !== null && diasVigencia >= 0 && diasVigencia < 60;
    const denuncia = !!row.denuncia_motivo;
    let estadoEfectivo;
    let estadoLabel;
    let estadoColor;
    let vigente = false;
    if (denuncia) {
        estadoEfectivo = 'BLOQUEADO';
        estadoLabel = 'Bloqueado — alerta activa';
        estadoColor = 'rojo';
    }
    else if (row.estado === 'RECHAZADO') {
        estadoEfectivo = 'RECHAZADO';
        estadoLabel = 'Rechazado por inspector';
        estadoColor = 'rojo';
    }
    else if (row.estado === 'PAGO_PENDIENTE') {
        estadoEfectivo = 'PAGO_PENDIENTE';
        estadoLabel = 'Pago de tasa en proceso';
        estadoColor = 'amarillo';
    }
    else if (row.estado === 'BORRADOR') {
        const listo = row.puntos_total >= 16 && row.fotos_count >= 1;
        estadoEfectivo = listo ? 'LISTO_PARA_PAGO' : 'INSPECCION_INCOMPLETA';
        estadoLabel = listo ? 'Listo para pagar tasa' : 'Inspección incompleta';
        estadoColor = listo ? 'amarillo' : 'gris';
    }
    else if (row.estado === 'ACTIVO') {
        if (expirado) {
            estadoEfectivo = 'EXPIRADO';
            estadoLabel = 'Vencido';
            estadoColor = 'rojo';
        }
        else if (!row.tasa_pagada) {
            estadoEfectivo = 'VIGENTE_SIN_TASA';
            estadoLabel = 'Activo — tasa pendiente';
            estadoColor = 'amarillo';
            vigente = true;
        }
        else if (!row.nft_token_id) {
            estadoEfectivo = 'VIGENTE_SIN_NFT';
            estadoLabel = 'Activo — NFT pendiente';
            estadoColor = 'azul';
            vigente = true;
        }
        else if (vencePronto) {
            estadoEfectivo = 'VENCE_PRONTO';
            estadoLabel = `Vigente — vence en ${diasVigencia} días`;
            estadoColor = 'amarillo';
            vigente = true;
        }
        else {
            estadoEfectivo = 'VIGENTE';
            estadoLabel = 'Vigente';
            estadoColor = 'verde';
            vigente = true;
        }
    }
    else {
        estadoEfectivo = 'INSPECCION_INCOMPLETA';
        estadoLabel = row.estado;
        estadoColor = 'gris';
    }
    // ── Alertas ─────────────────────────────────────────────
    const alertas = [];
    if (denuncia)
        alertas.push({
            tipo: 'ROBO',
            mensaje: `Denuncia activa: ${row.denuncia_motivo}`,
            accion: `GET /cit/${row.id}/alertas`,
        });
    if (expirado)
        alertas.push({
            tipo: 'VENCIMIENTO',
            mensaje: `CIT vencido hace ${Math.abs(diasVigencia)} días. Requiere nueva inspección.`,
            accion: `POST /inspector/cit/nuevo`,
        });
    if (vencePronto && !expirado)
        alertas.push({
            tipo: 'VENCIMIENTO_PROXIMO',
            mensaje: `El CIT vence en ${diasVigencia} días (${row.fecha_vencimiento?.slice(0, 10)}).`,
            accion: `POST /inspector/cit/renovar`,
        });
    if (row.estado === 'ACTIVO' && !row.tasa_pagada)
        alertas.push({
            tipo: 'TASA_PENDIENTE',
            mensaje: 'La tasa CIT no fue acreditada por MxM. El CIT está activo pero sin respaldo gubernamental completo.',
            accion: `POST /cit/pago`,
        });
    if (row.estado === 'ACTIVO' && !row.nft_token_id)
        alertas.push({
            tipo: 'NFT_PENDIENTE',
            mensaje: 'El token ERC-721 aún no fue minteado en la Blockchain Federal Argentina.',
            accion: `POST /bfa/mint/${row.id}`,
        });
    if (row.puntos_total < 16 && row.estado !== 'ACTIVO')
        alertas.push({
            tipo: 'PUNTAJE_INSUFICIENTE',
            mensaje: `Puntaje ${row.puntos_total}/20 — mínimo requerido: 16/20.`,
            accion: `GET /inspector/cit/${row.id}/puntos`,
        });
    // ── Verificación pública ─────────────────────────────────
    const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar';
    const verUrl = `${baseUrl}/verificar/${row.numero_cit}`;
    const qrData = JSON.stringify({
        cit: row.numero_cit,
        hash: row.hash_sha256?.slice(0, 16),
        bici: row.numero_serie,
        ver: verUrl,
    });
    return {
        id: row.id,
        numeroCIT: row.numero_cit,
        estadoBase: row.estado,
        estadoEfectivo,
        estadoLabel,
        estadoColor,
        vigente,
        bicicleta: {
            id: row.bici_id,
            numeroSerie: row.numero_serie,
            marca: row.marca,
            modelo: row.modelo,
        },
        propietario: {
            id: row.prop_id,
            nombre: row.propietario_nombre ?? row.prop_nombre ?? '—',
            dni: row.propietario_dni ?? '—',
        },
        inspector: {
            id: row.insp_id ?? null,
            nombre: row.insp_nombre
                ? `${row.insp_nombre} ${row.insp_apellido ?? ''}`.trim()
                : null,
            certificado: row.insp_certificado ?? false,
        },
        inspeccion: {
            puntosTotal: row.puntos_total ?? 0,
            puntosMax: 20,
            puntosMin: 16,
            aprobada: (row.puntos_total ?? 0) >= 16,
            fotosCount: row.fotos_count ?? 0,
            geoLat: row.insp_geo_lat ? parseFloat(row.insp_geo_lat) : null,
            geoLng: row.insp_geo_lng ? parseFloat(row.insp_geo_lng) : null,
        },
        blockchain: {
            hashSHA256: row.hash_sha256 || null,
            nftTokenId: row.nft_token_id || null,
            nftMinted: !!row.nft_token_id,
            bfaTxHash: row.firma_payload_hash || null,
        },
        tasa: {
            pagada: row.tasa_pagada ?? false,
            mxmPagoId: row.mxm_pago_id || null,
            mxmEstado: row.mxm_estado || null,
            montoARS: parseFloat(row.monto_ars ?? '3000'),
            expedienteId: row.expediente_id || row.mxm_expediente || null,
            aprobadaEn: row.pago_aprobado_en || null,
        },
        fechas: {
            emision: row.fecha_emision ? row.fecha_emision.slice(0, 10) : null,
            vencimiento: row.fecha_vencimiento ? row.fecha_vencimiento.slice(0, 10) : null,
            diasVigencia,
            creado: row.creado_en,
            actualizado: row.actualizado_en,
        },
        alertas,
        verificacionPublica: { url: verUrl, qrData },
    };
}
// Lookup por número de CIT (helper para rutas)
async function getCITEstadoPorNumero(numeroCIT) {
    return getCITEstado(numeroCIT);
}
