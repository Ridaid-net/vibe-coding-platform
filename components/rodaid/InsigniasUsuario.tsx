'use client'
import { useState } from 'react'
import { Shield, Star, Zap, Award, Lock, CheckCircle, ChevronRight } from 'lucide-react'

interface Insignia {
  id: string
  icono: React.ElementType
  color: string
  bg: string
  titulo: string
  descripcion: string
  condicion: string
  obtenida: boolean
  puntos: number
}

interface InsigniasUsuarioProps {
  tieneCit: boolean
  citActivo: boolean
  stravaConectado: boolean
  kmTotales: number
  tienePublicacion: boolean
  denunciasRegistradas: number
}

export function InsigniasUsuario({
  tieneCit,
  citActivo,
  stravaConectado,
  kmTotales,
  tienePublicacion,
  denunciasRegistradas,
}: InsigniasUsuarioProps) {
  const [expandido, setExpandido] = useState(false)

  const INSIGNIAS: Insignia[] = [
    {
      id: 'primer_cit',
      icono: Shield,
      color: '#2BBCB8',
      bg: 'bg-teal-50',
      titulo: 'Identidad Verificada',
      descripcion: 'Obtuviste tu primer CIT activo.',
      condicion: 'Tener un CIT activo',
      obtenida: citActivo,
      puntos: 100,
    },
    {
      id: 'strava',
      icono: Zap,
      color: '#FC4C02',
      bg: 'bg-orange-50',
      titulo: 'Ciclista Conectado',
      descripcion: 'Vinculaste tu cuenta de Strava.',
      condicion: 'Conectar Strava',
      obtenida: stravaConectado,
      puntos: 50,
    },
    {
      id: 'km_500',
      icono: Star,
      color: '#F47B20',
      bg: 'bg-amber-50',
      titulo: '500 km Verificados',
      descripcion: 'Acumulaste 500 km con tu bici certificada.',
      condicion: 'Registrar 500 km via Strava',
      obtenida: kmTotales >= 500,
      puntos: 75,
    },
    {
      id: 'km_1000',
      icono: Star,
      color: '#7c3aed',
      bg: 'bg-violet-50',
      titulo: '1000 km Verificados',
      descripcion: 'Alcanzaste 1000 km con tu bici certificada.',
      condicion: 'Registrar 1000 km via Strava',
      obtenida: kmTotales >= 1000,
      puntos: 150,
    },
    {
      id: 'publicacion',
      icono: Award,
      color: '#16a34a',
      bg: 'bg-green-50',
      titulo: 'Vendedor Confiable',
      descripcion: 'Publicaste una bici en el marketplace verificado.',
      condicion: 'Publicar una bicicleta con CIT',
      obtenida: tienePublicacion,
      puntos: 80,
    },
    {
      id: 'denuncia',
      icono: Shield,
      color: '#dc2626',
      bg: 'bg-red-50',
      titulo: 'Guardian de la Red',
      descripcion: 'Registraste una denuncia de hurto en la red RODAID.',
      condicion: 'Registrar una denuncia comunitaria',
      obtenida: denunciasRegistradas > 0,
      puntos: 60,
    },
  ]

  const obtenidas = INSIGNIAS.filter(i => i.obtenida)
  const puntosTotal = obtenidas.reduce((acc, i) => acc + i.puntos, 0)
  const nivel = puntosTotal >= 400 ? 'Embajador' : puntosTotal >= 200 ? 'Guardián' : puntosTotal >= 100 ? 'Explorador' : 'Ciclista'
  const colorNivel = puntosTotal >= 400 ? 'text-[#F47B20]' : puntosTotal >= 200 ? 'text-[#2BBCB8]' : puntosTotal >= 100 ? 'text-violet-600' : 'text-slate-warm'

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 mt-4">
      <button onClick={() => setExpandido(v => !v)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#0F1E35]">
            <Award className="size-5 text-[#F47B20]" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-ink">Mis Insignias RODAID</p>
            <p className={`text-xs font-semibold ${colorNivel}`}>Nivel: {nivel} · {puntosTotal} pts · {obtenidas.length}/{INSIGNIAS.length} insignias</p>
          </div>
        </div>
        <ChevronRight className={`size-4 text-slate-warm transition-transform ${expandido ? 'rotate-90' : ''}`} />
      </button>

      {expandido && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-1 mb-2">
            {['Ciclista', 'Explorador', 'Guardián', 'Embajador'].map((n, i) => (
              <div key={n} className={`flex-1 text-center text-[10px] font-semibold py-1 rounded-full ${nivel === n ? 'bg-[#0F1E35] text-white' : 'bg-slate-100 text-slate-400'}`}>{n}</div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {INSIGNIAS.map(ins => {
              const Icono = ins.icono
              return (
                <div key={ins.id} className={`rounded-xl p-3 border text-center ${ins.obtenida ? `${ins.bg} border-transparent` : 'bg-slate-50 border-slate-100 opacity-50'}`}>
                  <div className={`mx-auto flex size-10 items-center justify-center rounded-full mb-2 ${ins.obtenida ? 'bg-white shadow-sm' : 'bg-slate-100'}`}>
                    {ins.obtenida
                      ? <Icono className="size-5" style={{ color: ins.color }} />
                      : <Lock className="size-4 text-slate-400" />
                    }
                  </div>
                  <p className="text-xs font-semibold text-ink leading-tight">{ins.titulo}</p>
                  <p className="text-[10px] text-slate-warm mt-0.5">{ins.obtenida ? `+${ins.puntos} pts` : ins.condicion}</p>
                  {ins.obtenida && <CheckCircle className="size-3 text-green-500 mx-auto mt-1" />}
                </div>
              )
            })}
          </div>
          <div className="mt-3 rounded-xl bg-[#0F1E35]/5 p-3 text-center">
            <p className="text-xs text-slate-warm">Al llegar a <strong className="text-[#F47B20]">Embajador</strong> desbloqueás beneficios exclusivos con talleres aliados y aseguradoras RODAID.</p>
          </div>
        </div>
      )}
    </div>
  )
}
