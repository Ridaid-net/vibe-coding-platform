'use client'
import Link from 'next/link'
import { Play } from 'lucide-react'
import type { Noticia } from '@/lib/noticias'

export function NoticiaCard({ noticia, className = '' }: { noticia: Noticia; className?: string }) {
  return (
    <Link
      href={`/noticias/${noticia.id}`}
      className={`flex flex-col rounded-2xl border border-ink/10 bg-white p-4 hover:border-[#2BBCB8]/40 transition-colors ${className}`}
    >
      {noticia.imagen_url && (
        <div className="relative rounded-xl overflow-hidden bg-slate-100 mb-3 aspect-video">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={noticia.imagen_url} alt={noticia.titulo} className="w-full h-full object-cover" loading="lazy" />
          {noticia.video_url && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
              <span className="flex size-9 items-center justify-center rounded-full bg-white/90">
                <Play className="size-3.5 text-ink fill-ink" />
              </span>
            </span>
          )}
        </div>
      )}
      <h4 className="font-display text-sm font-bold text-[#0F1E35] leading-snug">{noticia.titulo}</h4>
      <p className="mt-1.5 whitespace-pre-line text-xs text-slate-warm leading-relaxed line-clamp-3">{noticia.resumen}</p>
    </Link>
  )
}
