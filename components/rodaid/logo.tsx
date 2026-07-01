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
        width={86}
        height={62}
        className="shrink-0"
        priority
      />
    </Link>
  )
}
