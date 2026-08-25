import type { ReactNode } from 'react'

/** Shared instrument-panel primitives.
 *
 *  Collected here because consistency is the whole point of the aesthetic: a
 *  label that reads differently in two places stops reading as an instrument.
 */

export function Legend({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`legend ${className}`}>{children}</span>
}

export function Readout({
  value,
  label,
  accent = false,
}: {
  value: ReactNode
  label: string
  accent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <Legend>{label}</Legend>
      <span
        className={`readout text-2xl leading-none ${accent ? 'text-signal' : 'text-ink-100'}`}
      >
        {value}
      </span>
    </div>
  )
}

export function Panel({
  title,
  aside,
  children,
  className = '',
}: {
  title?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`border hairline bg-ink-950/70 backdrop-blur-sm ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b hairline px-3 py-2">
          <Legend>{title}</Legend>
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="inline-flex border hairline">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1 font-cond text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
              active
                ? 'bg-signal text-ink-1000'
                : 'text-ink-500 hover:bg-ink-900 hover:text-ink-200'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-500">
      <span className="h-2 w-2 animate-ping rounded-full bg-signal" />
      <Legend>{label}</Legend>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 items-center justify-center px-6 text-center">
      <p className="max-w-sm text-sm leading-relaxed text-ink-500">{children}</p>
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="border border-sev-high/40 bg-sev-high/10 px-3 py-2">
      <Legend className="text-sev-high">Error</Legend>
      <p className="mt-1 font-mono text-xs text-ink-200">{message}</p>
    </div>
  )
}
