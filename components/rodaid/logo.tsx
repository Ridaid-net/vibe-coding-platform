import Image from 'next/image'

interface Props {
  className?: string
}

export function RodaidLogo({ className }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display font-extrabold tracking-tight ${className ?? ''}`}
    >
      <Image
        src="/logo-rodaid.jpeg"
        alt="RODAID"
        width={32}
        height={32}
        className="shrink-0 rounded-sm"
        priority
      />
      <span className="text-[1.35rem] leading-none">
        RODA<span className="text-lime-deep">ID</span>
      </span>
    </span>
  )
}
