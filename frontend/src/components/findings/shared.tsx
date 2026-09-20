import type { ReactNode } from 'react'
import { ArrowRight } from '../../ui/Symbols'
import type { Kind, Person } from '../../api/investigation'

export {
  Button,
  Callout,
  Chip,
  SectionHeading,
  StatStrip,
  type Tone,
} from '../../ui'
export const LABEL = 'text-xs font-semibold'
export const BORDER = 'border-border'

export function KindLabel({ kind }: { kind: Kind }) {
  const record = kind === 'record'
  return (
    <span
      className={`kind-label ${record ? 'kind-record' : 'kind-claim'}`}
      title={
        record
          ? 'Record: a row a system logged.'
          : 'Claim: something a person or report stated.'
      }
    >
      <span className="kind-symbol" aria-hidden="true">
        {record ? (
          <>
            <i />
            <i />
            <i />
          </>
        ) : (
          '“'
        )}
      </span>
      {record ? 'Record' : 'Claim'}
    </span>
  )
}

export function personText(
  person: Person | null | undefined,
  fallback = 'unknown person',
): string {
  return person ? `${person.label} (${person.case})` : fallback
}

export function PersonRef({
  person,
  fallback = 'unknown person',
  strong = true,
}: {
  person: Person | null | undefined
  fallback?: string
  strong?: boolean
}) {
  if (!person) return <span className="text-muted">{fallback}</span>
  return (
    <span className="inline">
      <span className={strong ? 'font-semibold text-heading' : 'text-body'}>
        {person.label}
      </span>{' '}
      <span className="case-reference">{person.case}</span>
    </span>
  )
}

export function ChainLine({
  chain,
  className = '',
}: {
  chain: string[]
  className?: string
}) {
  if (!chain.length) return <span className="text-muted">No chain</span>
  return (
    <span className={`chain-line ${className}`}>
      {chain.map((name, index) => (
        <span key={`${name}-${index}`}>
          {index > 0 && (
            <>
              <ArrowRight size={12} aria-hidden="true" />
              <span className="sr-only"> to </span>
            </>
          )}
          {name}
        </span>
      ))}
    </span>
  )
}

export function EvidenceLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-muted">{children}</span>
}
