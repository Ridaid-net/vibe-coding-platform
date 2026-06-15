import { createGatewayProvider } from '@ai-sdk/gateway'
import { Models } from './constants'
import type { JSONValue } from 'ai'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'

/**
 * Credenciales del AI Gateway.
 *
 * El proyecto RODAID se despliega en Netlify, donde se inyectan
 * `NETLIFY_AI_GATEWAY_KEY` y `NETLIFY_AI_GATEWAY_BASE_URL` en los runtimes de
 * cómputo. Se prioriza la clave propia de Vercel (`AI_GATEWAY_API_KEY`) si está
 * presente para mantener compatibilidad, y se cae a las variables de Netlify en
 * caso contrario. Antes, al faltar `AI_GATEWAY_API_KEY` en Netlify, el proveedor
 * fallaba en tiempo de ejecución.
 */
const gateway = createGatewayProvider({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.NETLIFY_AI_GATEWAY_KEY,
  baseURL:
    process.env.AI_GATEWAY_BASE_URL ?? process.env.NETLIFY_AI_GATEWAY_BASE_URL,
  headers: {
    'http-referer': 'https://rodaid.com.ar/',
    'x-title': 'RODAID',
  },
})

export interface ModelOptions {
  model: LanguageModelV3
  providerOptions?: Record<string, Record<string, JSONValue>>
  headers?: Record<string, string>
}

export function getModelOptions(
  modelId: string,
  options?: { reasoningEffort?: 'low' | 'medium' | 'high' }
): ModelOptions {
  if (modelId === Models.OpenAIGPT53Codex) {
    return {
      model: gateway(modelId),
      providerOptions: {
        openai: {
          include: ['reasoning.encrypted_content'],
          reasoningEffort: options?.reasoningEffort ?? 'low',
          reasoningSummary: 'auto',
          serviceTier: 'priority',
        } satisfies OpenAIResponsesProviderOptions,
      },
    }
  }

  if (
    modelId === Models.AnthropicClaudeSonnet46 ||
    modelId === Models.AnthropicClaudeOpus46
  ) {
    return {
      model: gateway(modelId),
      headers: { 'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14' },
      providerOptions: {
        anthropic: {
          cacheControl: { type: 'ephemeral' },
        },
      },
    }
  }

  return {
    model: gateway(modelId),
  }
}
