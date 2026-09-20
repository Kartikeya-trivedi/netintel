import type { CSSProperties } from 'react'

export function BrandLockup() {
  return (
    <span className="brand-lockup">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3 27V5h7l12 14V5h7v22h-7L10 13v14Z" fill="currentColor" />
        <path d="m10 5 12 14v8L10 13Z" fill="var(--brand-cut)" />
      </svg>
      <span>
        net<span>intel</span>
      </span>
    </span>
  )
}

export function Direction({
  kind = 'right',
  className = '',
}: {
  kind?: 'right' | 'up-right' | 'left' | 'down'
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      aria-hidden="true"
      className={`direction direction-${kind} ${className}`}
    >
      <path
        d="M3 10h13m-5-5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="miter"
      />
    </svg>
  )
}

export function SeverityLabel({ level }: { level: 'low' | 'medium' | 'high' }) {
  const count = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return (
    <span className={`severity-label severity-${level}`}>
      <span className="severity-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <i key={i} data-filled={i <= count} />
        ))}
      </span>
      <span>{level[0].toUpperCase() + level.slice(1)} priority</span>
    </span>
  )
}

export function CountTab({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  tone?: string
}) {
  return (
    <button
      type="button"
      className="count-tab"
      aria-pressed={active}
      onClick={onClick}
      style={tone ? ({ '--tab-tone': tone } as CSSProperties) : undefined}
    >
      <span>{label}</span>
      <span className="count-tab-number">{count}</span>
    </button>
  )
}

export function FileStamp({ filename }: { filename: string }) {
  const extension = filename.includes('.')
    ? filename.split('.').pop()?.slice(0, 4).toUpperCase()
    : 'DOC'
  return (
    <span className="file-stamp" aria-hidden="true" data-format={extension}>
      {extension}
    </span>
  )
}
