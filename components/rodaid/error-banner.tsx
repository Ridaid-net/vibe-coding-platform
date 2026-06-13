'use client'

// ─── RODAID · Banner de error y countdown de reintento ────────────────────
//
// Componentes de UI que muestran un `RodaidError` con su mensaje en español,
// botón de reintento (cuando el error es reintentable) y la acción contextual
// (por ejemplo «Ir al login» para errores de sesión). Usan los tokens de tema
// del proyecto (clases Tailwind), por lo que se adaptan a modo claro y oscuro.

import { AlertTriangle, RefreshCw, ServerCog, WifiOff, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ERROR_TYPE, type ErrorType, type RodaidError } from '@/lib/rodaid/errors'

const ICONOS: Record<ErrorType, typeof WifiOff> = {
  NETWORK: WifiOff,
  CLIENT: AlertTriangle,
  SERVER: ServerCog,
  STREAM: WifiOff,
  CANCEL: X,
  UNKNOWN: AlertTriangle,
}

export interface ErrorBannerProps {
  error: RodaidError | null
  onRetry?: () => void
  onDismiss?: () => void
  compact?: boolean
  className?: string
}

export function ErrorBanner({ error, onRetry, onDismiss, compact = false, className }: ErrorBannerProps) {
  if (!error) return null
  const Icono = ICONOS[error.tipo] ?? AlertTriangle
  const esRed = error.tipo === ERROR_TYPE.NETWORK || error.tipo === ERROR_TYPE.STREAM

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3.5 py-3',
        esRed
          ? 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
        compact && 'py-2',
        className
      )}
    >
      <Icono className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{error.titulo}</p>
        {!compact && <p className="mt-0.5 text-xs opacity-80">{error.detalle}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {error.puedeReintentar && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80"
            >
              <RefreshCw className="size-3" aria-hidden />
              Reintentar
            </button>
          )}
          {error.accion && (
            <button
              type="button"
              onClick={() => error.ejecutarAccion()}
              className="rounded-md bg-current px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-80"
            >
              {error.accion}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Cerrar"
              className="ml-auto rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export interface RetryCountdownProps {
  segundos: number | null
  intento?: number
  maxRetries?: number
  className?: string
}

export function RetryCountdown({ segundos, intento, maxRetries, className }: RetryCountdownProps) {
  if (!segundos) return null
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground',
        className
      )}
    >
      <RefreshCw className="size-3 animate-spin" aria-hidden />
      Reintentando en {segundos}s
      {intento && maxRetries ? ` (${intento}/${maxRetries})` : ''}
    </div>
  )
}
