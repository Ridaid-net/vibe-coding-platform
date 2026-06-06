// ─── RODAID · GET /api/v1/verificar/[serial] ──────────────────────────────
//
// Endpoint público del Verificador (Tarea 6). Recibe un número de serie y
// ejecuta un cruce PARALELO (Promise.all) de tres fuentes: la base de datos
// local (Netlify Blobs), la tabla de denuncias y la BFA on-chain (función
// `view` del contrato RodaidCIT.sol, emulada por lib/bfaService). Devuelve la
// respuesta pública unificada: estado canónico, bicicleta, inspección,
// propietario anonimizado, validación BFA on-chain, sello temporal y firma.
//
// Integridad: compara el hash de la DB contra el índice local de eventos y el
// hash on-chain (comparación triple). Una discrepancia dispara la alerta
// crítica HASH_MISMATCH_ONCHAIN → respuesta 422 + log de nivel ERROR.
//
// Resiliencia (fail-open): si el nodo BFA no responde (timeout / caído), la
// validación on-chain marca `consultada: false` y la verificación continúa con
// los datos locales — nunca traba al inspector en la calle.
//
// No requiere autenticación: la respuesta ya viene anonimizada y sin datos
// internos. Cachea en CDN respuestas encontradas (5 min) y acota las no
// encontradas (30 s) para mitigar DoS por sondeo de seriales.
//
// Al ser un endpoint público sin auth, se protege con el escudo perimetral
// anti-abuso (lib/rateLimiter): blocklist + burst (20/10s) + verificador
// (100/min) por IP, con bloqueos escalonados por strikes. Todas las respuestas
// —200, 422 y 429— inyectan los headers estándar RFC 6585.

import { NextResponse } from 'next/server'
import { getCITBySerial, getDenunciasActivas, getEventoIndexHash } from '@/lib/mockApi'
import {
  armarVerificacion,
  respuestaNoEncontrada,
  tieneMismatchOnChain,
} from '@/lib/verificador'
import { consultarBFAOnChain } from '@/lib/bfaService'
import { aplicarRateLimit } from '@/lib/rateLimiter'
import { registrarVerificacion, normalizarOrigen } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ serial: string }> }
) {
  const t0 = Date.now()

  // ── Escudo perimetral: rate limiting por IP ──────────────────────────────
  // Se evalúa antes de tocar la capa de datos. Si la guardia rechaza, se
  // responde 429 con los headers RFC 6585 (incluido Retry-After) ya armados.
  const guardia = await aplicarRateLimit(req)
  if (!guardia.ok) {
    return NextResponse.json(guardia.body, {
      status: guardia.status,
      headers: { ...guardia.headers, 'Cache-Control': 'no-store' },
    })
  }
  // Headers de rate limit inyectados en toda respuesta exitosa.
  const rlHeaders = guardia.headers

  // Origen declarado por el cliente (WEB | QR | APP | API), para la analítica.
  const url = new URL(req.url)
  const origen = normalizarOrigen(url.searchParams.get('origen'))
  // Disparador de la simulación de caída del nodo BFA (resiliencia fail-open):
  // ?bfa=timeout|down, o la variable de entorno BFA_SIMULAR_TIMEOUT.
  const forzarTimeout = ['timeout', 'down', 'caido'].includes(
    (url.searchParams.get('bfa') ?? '').toLowerCase()
  )

  const { serial: rawSerial } = await params
  const serial = decodeURIComponent(rawSerial ?? '').trim().toUpperCase()

  if (!serial) {
    return NextResponse.json(
      { error: 'Serial requerido' },
      { status: 400, headers: rlHeaders }
    )
  }

  try {
    // ── Cruce paralelo (Promise.all) ───────────────────────────────────────
    // Tres consultas simultáneas, como el verificador real:
    //   A. Base de datos local (Netlify Blobs): CIT completo.
    //   B. Tabla de denuncias: denuncias ACTIVAS del serial.
    //   C. BFA on-chain: función `view` del contrato RodaidCIT.sol.
    // La consulta on-chain es fail-open: NUNCA rechaza, de modo que un nodo BFA
    // caído no tumba el Promise.all ni traba la verificación del inspector.
    const [registro, denunciasActivas, onchain] = await Promise.all([
      getCITBySerial(serial),
      getDenunciasActivas(serial),
      consultarBFAOnChain(serial, { forzarTimeout }),
    ])

    if (!registro) {
      // Se responde 200 con `encontrado: false` (no 404): la consulta de
      // verificación se resolvió correctamente, la bicicleta simplemente no
      // está registrada. Devolver 404 haría que la capa estática de Netlify
      // sirviera su página HTML de error en lugar de este JSON. El TTL corto
      // acota el sondeo de seriales.
      const resp = respuestaNoEncontrada(serial, t0, onchain)
      // Registro anónimo best-effort (IP hasheada con salt diario, bots aparte).
      await registrarVerificacion(req, {
        serial,
        estado: resp.estado,
        encontrado: resp.encontrado,
        origen,
        duracionMs: resp.duracionMs,
      })
      return NextResponse.json(resp, {
        status: 200,
        headers: { ...rlHeaders, 'Cache-Control': 'public, max-age=30' },
      })
    }

    const resp = armarVerificacion(registro, t0, {
      onchain,
      denunciasActivas,
      hashEventoLocal: getEventoIndexHash(serial),
    })
    await registrarVerificacion(req, {
      serial,
      estado: resp.estado,
      encontrado: resp.encontrado,
      origen,
      duracionMs: resp.duracionMs,
    })

    // ── Intercepción de la alerta crítica de integridad ────────────────────
    // Si el hash de la DB no coincide con el de la cadena de bloques, se
    // responde 422 y se emite un log de nivel ERROR para alertar al equipo
    // RODAID de una posible manipulación del documento. La respuesta conserva
    // todo el detalle (incluida `blockchain.validacionOnChain`) para auditoría.
    if (tieneMismatchOnChain(resp)) {
      const v = resp.blockchain.validacionOnChain
      console.error('[verificador] HASH_MISMATCH_ONCHAIN', {
        serial,
        hashDB: v.hashDB,
        hashOnChain: v.hashOnChain,
        tokenIdOnChain: v.tokenIdOnChain,
        nodo: v.nodo,
      })
      return NextResponse.json(resp, {
        status: 422,
        headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
      })
    }

    return NextResponse.json(resp, {
      status: 200,
      headers: {
        ...rlHeaders,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    })
  } catch (err) {
    // La capa BFA y la anonimización son resilientes por diseño; un error aquí
    // es de infraestructura. Se responde 200 con "no encontrado" antes que
    // exponer un 500 al público.
    console.error('verificar error', err)
    const resp = respuestaNoEncontrada(serial, t0)
    return NextResponse.json(resp, {
      status: 200,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    })
  }
}
