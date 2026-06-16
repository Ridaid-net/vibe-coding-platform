import { ToggleWelcome } from '@/components/modals/welcome'
import { VercelDashed } from '@/components/icons/vercel-dashed'
import { GithubIcon } from '@/components/icons/github'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
}

// Repositorio del proyecto en GitHub. Configurable por entorno para forks.
const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ??
  'https://github.com/Ridaid-net/vibe-coding-platform'

export async function Header({ className }: Props) {
  return (
    <header className={cn('flex items-center justify-between', className)}>
      <div className="flex items-center">
        <VercelDashed className="ml-1 md:ml-2.5 mr-1.5" />
        <span className="hidden md:inline text-sm uppercase font-mono font-bold tracking-tight">
          OSS Vibe Coding Platform
        </span>
      </div>
      <div className="flex items-center ml-auto space-x-1.5">
        <Button asChild variant="outline" size="sm" className="cursor-pointer">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ver el codigo en GitHub"
          >
            <GithubIcon />
            <span className="hidden lg:inline">GitHub</span>
          </a>
        </Button>
        <ToggleWelcome />
      </div>
    </header>
  )
}
