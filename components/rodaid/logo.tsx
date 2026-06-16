interface Props {
  className?: string
}

/**
 * RODAID wordmark — a chain-link "O" gives the mark a cycling cue without
 * leaning on a literal bicycle silhouette.
 */
export function RodaidLogo({ className }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display font-extrabold tracking-tight ${className ?? ''}`}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 26 26"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="13" cy="13" r="11.5" stroke="currentColor" strokeWidth="2" />
        <circle cx="13" cy="13" r="4.5" stroke="currentColor" strokeWidth="2" />
        <path
          d="M13 1.5V8.5M13 17.5V24.5M1.5 13H8.5M17.5 13H24.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[1.35rem] leading-none">
        RODA<span className="text-lime-deep">ID</span>
      </span>
    </span>
  )
}
