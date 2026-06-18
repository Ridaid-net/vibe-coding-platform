// ─── RODAID-GPT · Anthropic claude-sonnet ─────────────────
//
// Asistente experto en la plataforma RODAID.
// Tiene contexto completo del ecosistema:
//   · Ley Provincial N° 9556 (certificación bicicletas)
//   · Proceso CIT: inspección → tasa MxM → NFT BFA
//   · Marketplace, Escrow, Retribución aliados
//   · Estado real del usuario (bicicletas, CITs, transacciones)
//
// ══ FLUJO ═════════════════════════════════════════════════
//
//   POST /ai/chat
//     → cargar historial de DB (últimos 20 mensajes)
//     → enriquecer system prompt con contexto del usuario
//     → Anthropic Messages API (streaming)
//     → guardar respuesta en DB
//     → retornar texto completo
//
// ══ MODELO ════════════════════════════════════════════════
//
//   claude-sonnet-4-20250514
//   max_tokens: 2048
//   temperature: 0.3 (respuestas precisas, técnicas)
//
// ══ SYSTEM PROMPT ════════════════════════════════════════
//
//   ROL: Asesor técnico y legal de RODAID
//   CONOCIMIENTO: Ley 9556, CIT, BFA, MxM, MP, escrow
//   CONTEXTO DINÁMICO: bicicletas y CITs del usuario
//   IDIOMA: español rioplatense

import Anthropic from '@anthropic-ai/sdk'
import { buildContextoRico } from './rodaid.context.service'
import { query, queryOne } from '../config/database'
import { log }             from '../middleware/logger'
import { AppError }        from '../middleware/errorHandler'

// ══════════════════════════════════════════════════════════
// CLIENTE
// ══════════════════════════════════════════════════════════

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new AppError('ANTHROPIC_API_KEY no configurada. Agregar al .env de producción.', 503, 'AI_NO_DISPONIBLE')
  return new Anthropic({ apiKey })
}

const MODELO = 'claude-sonnet-4-20250514'

// ══════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ══════════════════════════════════════════════════════════

const SYSTEM_BASE = `Sos RODAID-GPT, el asistente oficial de la plataforma RODAID.

RODAID es la primera plataforma de certificación técnica de bicicletas de Argentina bajo la Ley Provincial N° 9556 de Mendoza. Operás en la Zona Este: San Martín, Junín y Rivadavia.

═══ TU ROL ═══════════════════════════════════════════════
Asesor técnico, legal y operativo de RODAID. Respondés preguntas sobre:

1. CERTIFICACIÓN (CIT — Certificado de Identidad Técnica)
   • Proceso: inspección inspector certificado → 16/20 puntos mínimo → tasa MxM $3.000 ARS → NFT ERC-721 en BFA
   • Vigencia: 12 meses desde emisión
   • Ley 9556: Arts. 11/12 (obligatoriedad talleres), Art. 17 (código único), Art. 18 (aranceles)
   • Blockchain: hash SHA-256 → IPFS → safeMint en contrato "Rodaid Certificado" (RCIT)

2. MARKETPLACE RODAID
   • Escrow: fondos retenidos hasta confirmación de entrega
   • Split: 97.5% vendedor / 2.5% RODAID (comisión marketplace)
   • Auto-release: 5 días sin confirmación
   • Disputas: 72h de SLA para resolución

3. PAGOS
   • Tasa CIT: $3.000 ARS vía MxM (canal oficial Gobierno de Mendoza)
   • Marketplace: MercadoPago OAuth 2.0
   • Retribución aliados: PIONERO 35% / CONSTRUCTOR 40% / ESCALADOR 45% de la tasa CIT

4. ESTADO EN TIEMPO REAL
   • SSE: GET /cit/:id/rt — streaming del progreso de validación
   • Deadline: 72 horas para completar la validación del CIT
   • Estados: VIGENTE / VIGENTE_SIN_TASA / VIGENTE_SIN_NFT / EXPIRADO / BLOQUEADO

5. LEGAL Y REGULATORIO
   • Ley 9556: bicicletas registradas en municipios de Mendoza
   • MxM: plataforma digital oficial del Gobierno de Mendoza
   • BFA: Blockchain Federal Argentina (ONTI) — nodo oficial del Estado
   • Denuncias de robo: notificación a MinSeg con geolocalización

═══ CÓMO RESPONDÉS ══════════════════════════════════════
- Español rioplatense (vos, ustedes)
- Preciso, técnico cuando se necesita, simple cuando no
- Siempre mencionás el endpoint o acción concreta si aplica
- Si el usuario tiene bicicletas o CITs, los mencionás por nombre
- No inventás información que no tenés; admitís la incertidumbre
- Cuando el usuario necesita acción, le das el paso siguiente exacto`

// buildContextoUsuario delegada a rodaid.context.service.ts (buildContextoRico)

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface MensajeChat {
  rol:     'user' | 'assistant'
  content: string
  ts:      string
}

export interface ChatInput {
  usuarioId:       string
  conversacionId?: string   // si es None → nueva conversación
  mensaje:         string
  maxTokens?:      number
}

export interface ChatResult {
  conversacionId: string
  respuesta:      string
  tokensEntrada:  number
  tokensSalida:   number
  modelo:         string
  conversacion?: {
    titulo:    string
    mensajes:  MensajeChat[]
    creado_en: string
  }
}

// ══════════════════════════════════════════════════════════
// CHAT PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function chatRodaidGPT(input: ChatInput): Promise<ChatResult> {
  const client = getClient()

  // 1. Cargar o crear conversación
  let conv = input.conversacionId
    ? await queryOne<{ id: string; mensajes: MensajeChat[]; titulo: string; creado_en: string }>(
        `SELECT id::text, mensajes, titulo, creado_en::text
         FROM ai_conversaciones
         WHERE id=$1::uuid AND usuario_id=$2::uuid AND activa=TRUE`,
        [input.conversacionId, input.usuarioId]
      )
    : null

  if (!conv) {
    // Nueva conversación — título auto-generado del primer mensaje
    const titulo = input.mensaje.slice(0, 80).replace(/\n/g, ' ') + (input.mensaje.length > 80 ? '…' : '')
    const row = await queryOne<{ id: string; creado_en: string }>(
      `INSERT INTO ai_conversaciones (usuario_id, titulo, mensajes)
       VALUES ($1::uuid, $2, '[]'::jsonb) RETURNING id::text, creado_en::text`,
      [input.usuarioId, titulo]
    )
    conv = { id: row!.id, mensajes: [], titulo, creado_en: row!.creado_en }
  }

  const historial: MensajeChat[] = Array.isArray(conv.mensajes) ? conv.mensajes : []

  // 2. System prompt enriquecido con contexto del usuario
  const contextUsuario = await buildContextoRico(input.usuarioId)
  const systemPrompt   = SYSTEM_BASE + contextUsuario

  // 3. Construir mensajes para la API (máximo últimos 20 para control de tokens)
  const mensajesHistorial: Anthropic.MessageParam[] = historial.slice(-20).map(m => ({
    role:    m.rol === 'user' ? 'user' : 'assistant',
    content: m.content,
  }))

  // Agregar el mensaje actual
  mensajesHistorial.push({ role: 'user', content: input.mensaje })

  // 4. Llamar a la API de Anthropic
  log.mxm.info({ convId: conv.id.slice(0, 8), usuario: input.usuarioId.slice(0, 8) },
    '🤖 RODAID-GPT: enviando mensaje')

  const response = await client.messages.create({
    model:      MODELO,
    max_tokens: input.maxTokens ?? 2048,
    system:     systemPrompt,
    messages:   mensajesHistorial,
  })

  const respuesta     = response.content[0].type === 'text' ? response.content[0].text : ''
  const tokensEntrada = response.usage.input_tokens
  const tokensSalida  = response.usage.output_tokens

  // 5. Guardar en DB (historial + tokens acumulados)
  const nuevoHistorial: MensajeChat[] = [
    ...historial,
    { rol: 'user',      content: input.mensaje, ts: new Date().toISOString() },
    { rol: 'assistant', content: respuesta,      ts: new Date().toISOString() },
  ]
  // Limitar a 100 mensajes para no superar 64KB de JSONB
  const historialFinal = nuevoHistorial.slice(-100)

  await query(
    `UPDATE ai_conversaciones SET
       mensajes       = $2::jsonb,
       tokens_entrada = tokens_entrada + $3,
       tokens_salida  = tokens_salida  + $4,
       actualizado_en = NOW()
     WHERE id = $1::uuid`,
    [conv.id, JSON.stringify(historialFinal), tokensEntrada, tokensSalida]
  )

  log.mxm.info({
    convId: conv.id.slice(0, 8),
    tokensEntrada, tokensSalida,
    respuestaLen: respuesta.length,
  }, '✅ RODAID-GPT: respuesta emitida')

  return {
    conversacionId: conv.id,
    respuesta,
    tokensEntrada,
    tokensSalida,
    modelo: MODELO,
    conversacion: {
      titulo:    conv.titulo,
      mensajes:  historialFinal,
      creado_en: conv.creado_en,
    },
  }
}

// ══════════════════════════════════════════════════════════
// STREAMING (SSE para respuesta en tiempo real)
// ══════════════════════════════════════════════════════════

export async function chatRodaidGPTStream(
  input: ChatInput,
  onChunk: (chunk: string) => void,
  onDone:  (result: { conversacionId: string; tokens: { entrada: number; salida: number } }) => void,
  onError: (err: Error) => void
): Promise<void> {
  const client = getClient()

  let conv = input.conversacionId
    ? await queryOne<{ id: string; mensajes: MensajeChat[]; titulo: string }>(
        `SELECT id::text, mensajes, titulo FROM ai_conversaciones
         WHERE id=$1::uuid AND usuario_id=$2::uuid AND activa=TRUE`,
        [input.conversacionId, input.usuarioId]
      )
    : null

  if (!conv) {
    const titulo = input.mensaje.slice(0, 80)
    const row = await queryOne<{ id: string }>(
      `INSERT INTO ai_conversaciones (usuario_id, titulo, mensajes)
       VALUES ($1::uuid,$2,'[]'::jsonb) RETURNING id::text`, [input.usuarioId, titulo]
    )
    conv = { id: row!.id, mensajes: [], titulo }
  }

  const historial: MensajeChat[] = Array.isArray(conv.mensajes) ? conv.mensajes : []
  const contextRico  = await buildContextoRico(input.usuarioId)
  const systemPrompt = SYSTEM_BASE + '\n\n═══ CONTEXTO DEL USUARIO ═══\n' + contextRico

  const msgs: Anthropic.MessageParam[] = [
    ...historial.slice(-20).map(m => ({ role: m.rol === 'user' ? 'user' as const : 'assistant' as const, content: m.content })),
    { role: 'user', content: input.mensaje },
  ]

  let respuestaCompleta = ''
  let tokensEntrada = 0; let tokensSalida = 0

  try {
    const stream = client.messages.stream({
      model: MODELO, max_tokens: input.maxTokens ?? 2048,
      system: systemPrompt, messages: msgs,
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onChunk(event.delta.text)
        respuestaCompleta += event.delta.text
      }
      if (event.type === 'message_delta' && event.usage) {
        tokensSalida = event.usage.output_tokens
      }
      if (event.type === 'message_start' && event.message.usage) {
        tokensEntrada = event.message.usage.input_tokens
      }
    }

    // Guardar conversación
    const historialFinal = [
      ...historial,
      { rol: 'user'     , content: input.mensaje,        ts: new Date().toISOString() },
      { rol: 'assistant', content: respuestaCompleta,     ts: new Date().toISOString() },
    ].slice(-100)

    await query(
      `UPDATE ai_conversaciones SET mensajes=$2::jsonb,
         tokens_entrada=tokens_entrada+$3, tokens_salida=tokens_salida+$4,
         actualizado_en=NOW() WHERE id=$1::uuid`,
      [conv.id, JSON.stringify(historialFinal), tokensEntrada, tokensSalida]
    )

    onDone({ conversacionId: conv.id, tokens: { entrada: tokensEntrada, salida: tokensSalida } })
  } catch (err) {
    onError(err as Error)
  }
}

// ══════════════════════════════════════════════════════════
// GESTIÓN DE CONVERSACIONES
// ══════════════════════════════════════════════════════════

export async function getConversaciones(usuarioId: string, limite = 20) {
  return query<any>(
    `SELECT id::text, titulo, modelo, tokens_entrada, tokens_salida,
            creado_en, actualizado_en,
            jsonb_array_length(mensajes) AS cantidad_mensajes
     FROM ai_conversaciones
     WHERE usuario_id=$1::uuid AND activa=TRUE
     ORDER BY actualizado_en DESC LIMIT $2`,
    [usuarioId, limite]
  )
}

export async function getConversacion(convId: string, usuarioId: string) {
  return queryOne<any>(
    `SELECT id::text, titulo, modelo, mensajes, tokens_entrada, tokens_salida,
            creado_en, actualizado_en
     FROM ai_conversaciones
     WHERE id=$1::uuid AND usuario_id=$2::uuid AND activa=TRUE`,
    [convId, usuarioId]
  )
}

export async function eliminarConversacion(convId: string, usuarioId: string) {
  await query(
    `UPDATE ai_conversaciones SET activa=FALSE WHERE id=$1::uuid AND usuario_id=$2::uuid`,
    [convId, usuarioId]
  )
}

export async function getTokensUsados(usuarioId: string, dias = 30) {
  return queryOne<any>(
    `SELECT
       COUNT(*)::int AS conversaciones,
       COALESCE(SUM(tokens_entrada),0)::int AS tokens_entrada_total,
       COALESCE(SUM(tokens_salida),0)::int  AS tokens_salida_total,
       COALESCE(SUM(tokens_entrada+tokens_salida),0)::int AS tokens_total
     FROM ai_conversaciones
     WHERE usuario_id=$1::uuid AND activa=TRUE
       AND creado_en > NOW()-($2||' days')::interval`,
    [usuarioId, dias]
  )
}
