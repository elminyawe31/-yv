import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      className={cn("h-9 w-9", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="el-gold" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD98E" />
          <stop offset="0.5" stopColor="#E9A23B" />
          <stop offset="1" stopColor="#B87A1E" />
        </linearGradient>
        <linearGradient id="el-inner" x1="12" y1="8" x2="36" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1A1A22" />
          <stop offset="1" stopColor="#0C0C10" />
        </linearGradient>
      </defs>
      {/* Rounded hexagon-ish shield */}
      <path
        d="M24 2.5 41.5 12v24L24 45.5 6.5 36V12L24 2.5Z"
        fill="url(#el-inner)"
        stroke="url(#el-gold)"
        strokeWidth="2"
      />
      <path
        d="M24 6.5 38 14.4v19.2L24 41.5 10 33.6V14.4L24 6.5Z"
        fill="none"
        stroke="rgba(255,217,142,0.25)"
        strokeWidth="0.75"
      />
      {/* Lightning bolt */}
      <path
        d="M26.5 13 17.5 26.2h5.4l-1.9 8.8 9.5-13.6h-5.6L26.5 13Z"
        fill="url(#el-gold)"
      />
      <path
        d="M26.5 13 17.5 26.2h5.4l-1.9 8.8 9.5-13.6h-5.6L26.5 13Z"
        fill="none"
        stroke="rgba(255,240,200,0.5)"
        strokeWidth="0.5"
      />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-bold tracking-wide select-none", className)}>
      <span className="text-gold-gradient">ELMINYAWE</span>
    </span>
  )
}
