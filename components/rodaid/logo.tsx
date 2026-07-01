import Image from 'next/image'
import Link from 'next/link'

interface Props {
  className?: string
}

export function RodaidLogo({ className }: Props) {
  return (
    <Link href="/" className={`inline-flex items-center ${className ?? ''}`}>
      <Image
        src="/logo-rodaid.jpeg"
        alt="RODAID - Ir al inicio"
        width={96}
        height={72}
        className="shrink-0 rounded-xl"
        priority
      />
    </Link>
  )
}
