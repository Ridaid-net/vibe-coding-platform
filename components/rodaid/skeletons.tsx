'use client'

// ─── RODAID · Skeleton loaders ───────────────────────────────────────────
//
// Placeholders animados que se muestran mientras llega la respuesta real de
// cada fetch, en lugar de spinners genéricos o de datos simulados. El shimmer
// usa `animate-pulse` sobre `bg-muted`, que toma los tokens de tema del
// proyecto, así que funciona en modo claro y oscuro sin ajustes.
//
//   const { data, loading } = useFetch(() => marketplace.buscar())
//   if (loading) return <SkeletonMisPublicaciones cards={3} />

import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden />
}

function Card({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-border bg-card p-4', className)}>{children}</div>
}

// GET /usuario/bicicletas — Garaje Digital
export function SkeletonGaraje({ items = 3 }: { items?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
      {Array.from({ length: items }).map((_, i) => (
        <Card key={i} className="space-y-3">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  )
}

// GET /marketplace/pagos — dashboard de pagos / escrow
export function SkeletonPagosDashboard() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
          </Card>
        ))}
      </div>
      <Card className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  )
}

// GET /marketplace/mis-publicaciones — listings del usuario
export function SkeletonMisPublicaciones({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i} className="flex items-center gap-4">
          <Skeleton className="size-16 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </Card>
      ))}
    </div>
  )
}

// GET /analitica/personal — dashboard de analítica
export function SkeletonAnalitica() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
          </Card>
        ))}
      </div>
      <Card>
        <Skeleton className="h-48 w-full rounded-lg" />
      </Card>
    </div>
  )
}

// GET /cit/:id — tarjeta de Certificado de Identidad Técnica
export function SkeletonCITCard() {
  return (
    <Card className="space-y-4" aria-busy>
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-between gap-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
    </Card>
  )
}

// GET /mapa/calor — mapa de calor de recorridos
export function SkeletonMapaCalor() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border" aria-busy>
      <Skeleton className="h-72 w-full rounded-none" />
      <div className="absolute right-3 top-3 space-y-2">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    </div>
  )
}

// POST /gpt/consulta/stream — burbuja de chat mientras el stream no emitió
// el primer chunk. Tres puntos con rebote desfasado.
export function SkeletonGPTBubble() {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-2xl bg-muted px-4 py-3" aria-busy aria-label="Escribiendo…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-2 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  )
}

// ─── HOC withSkeleton ────────────────────────────────────────────────────
// Envuelve un componente para mostrar su skeleton mientras `loading` es true.
export function withSkeleton<P extends object>(
  Component: ComponentType<P>,
  SkeletonComponent: ComponentType
) {
  function ConSkeleton(props: P & { loading?: boolean }) {
    const { loading, ...rest } = props as P & { loading?: boolean }
    if (loading) return <SkeletonComponent />
    return <Component {...(rest as P)} />
  }
  ConSkeleton.displayName = `withSkeleton(${Component.displayName ?? Component.name ?? 'Component'})`
  return ConSkeleton
}
