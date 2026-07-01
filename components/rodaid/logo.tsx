import Image from 'next/image'

interface Props {
  className?: string
}

export function RodaidLogo({ className }: Props) {
  return (
    <span className={`inline-flex items-center ${className ?? ''}`}>
      <Image
        src="/logo-rodaid.jpeg"
        alt="RODAID"
        width={86}
        height={62}
        className="shrink-0"
        priority
      />
    </span>
  )
}
