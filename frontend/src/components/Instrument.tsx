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
    <div className="flex flex-col gap-1.5">
      <Legend>{label}</Legend>
      <span
        className={`readout text-2xl leading-none ${accent ? 'text-signal' : 'text-ink-100'}`}
      >
        {value}
      </span>
    </div>
  )
}

/** Page title block. Every scrolling page opens with one so titles sit at the
 *  same optical height and against the same rule. */
export function PageHeader({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow: string
  title: ReactNode
  children?: ReactNode
  aside?: ReactNode
}) {
  return (
    <header className="border-b hairline pb-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <Legend>{eyebrow}</Legend>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children && (
        <div className="mt-2.5 max-w-2xl text-sm leading-relaxed text-ink-500">{children}</div>
      )}
    </header>
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
    <section className={`bezel border hairline bg-ink-950/70 backdrop-blur-sm ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b hairline px-3 py-2">
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
    <div className="flex h-full min-h-32 items-center justify-center px-6 py-10 text-center">
      <p className="max-w-sm text-sm leading-relaxed text-ink-500">{children}</p>
    </div>
  )
}

/** Empty state with enough structure to read as a designed rest state rather
 *  than a page that failed to load. */
export function EmptyPanel({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="bezel border hairline bg-ink-950/50 px-6 py-12 text-center">
      <span className="mx-auto block h-px w-10 bg-signal/50" />
      <p className="mt-4 font-cond text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">{children}</p>
      {action && <div className="mt-5">{action}</div>}
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
