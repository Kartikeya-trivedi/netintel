import type { ButtonHTMLAttributes, ReactNode } from 'react'

import type { Kind, Person } from '../../api/investigation'
import { Legend } from '../Instrument'

/** Small shared parts of the findings views.
 *
 *  Three kinds of statement meet on these screens and each keeps one look
 *  everywhere: a RECORD (something a system logged) is solid, a CLAIM
 *  (something a source said) is hatched and dashed, and an ANALYST decision
 *  is stamped in the signal colour. The words always travel with the look.
 */

/** The .legend face and the hairline rule, as plain utilities. Kept for
 *  elements that set their own colour or change their border on hover or
 *  selection; since index.css moved .legend and .hairline into the components
 *  layer, "legend text-signal" works too, but these read the same everywhere. */
export const LEGEND = 'font-cond text-[10px] font-semibold uppercase tracking-[0.14em]'
export const RULE = 'border-[color:var(--rule-color)]'

export type Tone = 'neutral' | 'lead' | 'supported' | 'signal' | 'muted'

const TONES: Record<Tone, string> = {
  neutral: 'border-ink-800 text-ink-400',
  lead: 'border-status-lead/50 bg-status-lead/10 text-status-lead',
  supported: 'border-status-supported/45 bg-status-supported/10 text-status-supported',
  signal: 'border-signal/50 bg-signal/10 text-signal',
  muted: 'border-ink-850 text-ink-500',
}

export function Tag({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap border px-1.5 py-0.5 font-cond text-[10px] font-semibold uppercase tracking-[0.1em] ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** RECORD or CLAIM, with the matching swatch. */
export function KindLabel({ kind }: { kind: Kind }) {
  const record = kind === 'record'
  return (
    <span
      title={
        record
          ? 'Record: a row a system logged (call detail, bank statement, subscriber register).'
          : 'Claim: something a person or report stated. Not an observation.'
      }
      className={`inline-flex w-[62px] shrink-0 items-center gap-1.5 border px-1.5 py-0.5 font-cond text-[10px] font-semibold uppercase tracking-[0.1em] ${
        record ? 'border-ink-700 text-ink-200' : 'border-dashed border-ink-700 text-ink-400'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 ${record ? 'bg-ink-400' : 'hatch border border-ink-500 text-ink-500'}`}
      />
      {record ? 'Record' : 'Claim'}
    </span>
  )
}

type ButtonVariant = 'quiet' | 'primary' | 'danger' | 'link'

const BUTTON: Record<ButtonVariant, string> = {
  quiet: `border ${RULE} px-2.5 py-1 text-ink-200 enabled:hover:border-signal enabled:hover:text-signal`,
  primary:
    'border border-signal bg-signal px-3 py-1.5 text-ink-1000 enabled:hover:border-signal-dim enabled:hover:bg-signal-dim',
  danger: 'border border-signal px-2.5 py-1 text-signal enabled:hover:bg-signal enabled:hover:text-ink-1000',
  link: 'px-0 py-0.5 text-ink-400 enabled:hover:text-signal',
}

export function ActionButton({
  variant = 'quiet',
  className = '',
  children,
  ...rest
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center gap-1.5 font-cond text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

/** Section title inside a surface: a legend on a rule, with room for a count
 *  or a control on the right. */
export function SectionHeading({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="border-b hairline pb-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="legend">{title}</h2>
        {aside}
      </div>
      {children && <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">{children}</p>}
    </div>
  )
}

export function personText(person: Person | null | undefined, fallback = 'unknown person'): string {
  return person ? `${person.label} (${person.case})` : fallback
}

/** "Rohit Vaze (BM-1)", the case code set as a readout. */
export function PersonRef({
  person,
  fallback = 'unknown person',
  strong = true,
}: {
  person: Person | null | undefined
  fallback?: string
  strong?: boolean
}) {
  if (!person) return <span className="text-ink-500">{fallback}</span>
  return (
    <span className="whitespace-nowrap">
      <span className={strong ? 'text-ink-100' : 'text-ink-200'}>{person.label}</span>{' '}
      <span className="readout text-[0.85em] text-ink-500">({person.case})</span>
    </span>
  )
}

/** A chain of names joined by arrows, as text. */
export function ChainLine({ chain, className = '' }: { chain: string[]; className?: string }) {
  if (chain.length === 0) return <span className="text-ink-500">No chain</span>
  return (
    <span className={className}>
      {chain.map((name, index) => (
        <span key={`${name}-${index}`}>
          {index > 0 && (
            <span aria-hidden="true" className="mx-1.5 text-signal-dim">
              →
            </span>
          )}
          {index > 0 && <span className="sr-only"> to </span>}
          {name}
        </span>
      ))}
    </span>
  )
}

/** Labelled numbers in one ruled strip, the way the overview page reads.
 *  Columns follow the strip's own width (it sits in narrow panes as well as
 *  wide ones). Pass a multiple of four cells so every row is full. */
export function ReadoutStrip({ cells }: { cells: { label: string; value: ReactNode; title?: string }[] }) {
  return (
    <div className="@container">
      <dl className="grid grid-cols-2 gap-px border hairline gap-fill @md:grid-cols-4 @3xl:grid-cols-8">
        {cells.map((cell) => (
          <div key={cell.label} title={cell.title} className="bg-ink-1000 px-3 py-2">
            <dt>
              <Legend>{cell.label}</Legend>
            </dt>
            <dd className="readout mt-1 text-[15px] leading-none text-ink-100">{cell.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Explicit rest state inside a surface: says what is missing and why. */
export function Note({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'signal' | 'lead' }) {
  const border =
    tone === 'signal' ? 'border-signal/50' : tone === 'lead' ? 'border-status-lead/50' : 'border-ink-800'
  return (
    <p className={`border-l-2 ${border} bg-ink-950/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-400`}>
      {children}
    </p>
  )
}
