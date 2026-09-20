import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import {
  inv,
  type Contrast,
  type FindingSummary,
  type Status,
} from '../../api/investigation'
import { plural } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { ErrorNote, FieldLabel, LoadingState } from '../../ui'
import { ChainLine, LABEL, Callout, SectionHeading, Chip } from './shared'
import StatusBadge, { statusLabel } from './StatusBadge'

/** The same case files through an ordinary resolved graph, and through this
 *  workspace.
 *
 *  An ordinary graph merges people by name, gives a number to everyone ever
 *  recorded against it, and counts every document as a separate source. That
 *  lets a single repeated tip look as firmly connected as a chain of bank and
 *  call records, and an investigation would follow it. Each pair sits side by
 *  side so the difference is legible row by row; the rows where the ordinary
 *  reading overstates are called out above the table, computed, not written in.
 */

type Row = Contrast['findings'][number]

const OURS_RULES = [
  'Same-name references stay separate until an analyst accepts, with cited evidence, that they are one person.',
  'A number or account is read as whoever held it on the day of each call or transfer.',
  'Copies and repeats of one source count as one origin, not as corroboration.',
  'Routes through a high-activity contact are leads, not support.',
]

function differences(row: Row): {
  status: boolean
  route: boolean
  missing: boolean
} {
  const ours: Status = row.ours?.status ?? 'unsupported'
  const oursChain = row.ours?.headline?.chain.join('→') ?? ''
  return {
    status: row.naive_status !== ours,
    route: Boolean(row.ours) && row.naive_chain.join('→') !== oursChain,
    missing: row.ours === null,
  }
}

export default function ContrastView({
  workspaceId,
  scope,
  revision,
}: {
  workspaceId: number
  scope: string
  revision: number
}) {
  const contrast = useScopedAsync(() => inv.contrast(workspaceId), scope, [
    revision,
  ])
  const findings = useScopedAsync(() => inv.findings(workspaceId), scope, [
    revision,
  ])
  const byKey = useMemo(
    () =>
      new Map((findings.data ?? []).map((finding) => [finding.key, finding])),
    [findings.data],
  )

  const rows = contrast.data?.findings ?? []
  const overstated = rows.filter(
    (row) =>
      row.naive_status === 'supported' &&
      (row.ours === null || row.ours.status !== 'supported'),
  )
  const rerouted = rows.filter((row) => {
    const diff = differences(row)
    return diff.route && !diff.status
  })

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-heading">
          What an ordinary resolved graph would report
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-body">
          On the left, the simplified rules listed below. On the right, this
          workspace. Neither column is a judgement about anyone; the difference
          is in what each treats as evidence of a connection.
        </p>
      </header>

      {contrast.loading && !contrast.data && (
        <LoadingState label="Reading both graphs" />
      )}
      {contrast.error && <ErrorNote message={contrast.error} />}

      {contrast.data && (
        <>
          <details className="comparison-rules">
            <summary>
              How the two methods handle evidence
              <span aria-hidden="true">+</span>
            </summary>
            <div className="grid gap-px border-t border-border bg-border md:grid-cols-2">
              <div className="bg-canvas px-4 py-3">
                <FieldLabel>An ordinary resolved graph assumes</FieldLabel>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-body">
                  {contrast.data.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ol>
              </div>
              <div className="bg-canvas px-4 py-3">
                <FieldLabel>This workspace instead</FieldLabel>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-body">
                  {OURS_RULES.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ol>
              </div>
            </div>
          </details>

          {overstated.length > 0 ? (
            <div className="border-l-2 border-primary bg-primary/10 px-4 py-3">
              <p className={`${LABEL} text-primary`}>
                Where the ordinary graph overstates
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-heading">
                It reports {plural(overstated.length, 'connection')} as
                supported that this workspace{' '}
                {overstated.every((row) => row.ours === null)
                  ? 'does not find at all'
                  : overstated.every((row) => row.ours?.status === 'lead')
                    ? 'holds only as a lead needing review'
                    : 'holds only as a lead, or does not find'}
                :{' '}
                {overstated.map((row, index) => (
                  <span key={`${row.a}-${row.b}`}>
                    {index > 0 && '; '}
                    <strong className="font-semibold">
                      {row.a} ({row.cases[0]}) ↔ {row.b} ({row.cases[1]})
                    </strong>{' '}
                    ({row.ours ? statusLabel(row.ours.status) : 'not a finding'}
                    )
                  </span>
                ))}
                . Following this simplified reading would treat{' '}
                {overstated.length === 1 ? 'it' : 'them'} as established.
              </p>
            </div>
          ) : (
            <Callout>Both readings agree on the status of every pair.</Callout>
          )}
          {rerouted.length > 0 && (
            <p className="text-sm leading-relaxed text-body">
              {plural(rerouted.length, 'pair')} agree on status but not on the
              route:{' '}
              {rerouted
                .map(
                  (row) =>
                    `${row.a} ↔ ${row.b} runs ${row.naive_chain.join(' → ')} in the ordinary graph`,
                )
                .join('; ')}
              .
            </p>
          )}

          <section className="space-y-3">
            <SectionHeading title={`Accused pairs · ${rows.length}`}>
              The ordinary graph counts documents as independent sources. This
              workspace also counts origins: copies and repeats of one source
              count once.
            </SectionHeading>
            <div className="relative overflow-x-auto border border-border">
              <table className="w-full min-w-[820px] text-left">
                <thead className="border-b border-border bg-surface">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      <FieldLabel>Accused pair</FieldLabel>
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <FieldLabel>Ordinary resolved graph</FieldLabel>
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <FieldLabel>This workspace</FieldLabel>
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <FieldLabel>Difference</FieldLabel>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <ContrastRow
                      key={`${row.a}-${row.b}`}
                      row={row}
                      ours={row.ours ? (byKey.get(row.ours.key) ?? null) : null}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function ContrastRow({ row, ours }: { row: Row; ours: FindingSummary | null }) {
  const diff = differences(row)
  const flagged = diff.status || diff.missing

  return (
    <tr className={`align-top ${flagged ? 'bg-primary/5' : ''}`}>
      <td
        className={`border-l-2 px-3 py-3 ${flagged ? 'border-l-primary' : 'border-l-transparent'}`}
      >
        <p className="text-sm font-medium text-heading">
          {row.a}{' '}
          <span className="numeric text-xs font-normal text-muted">
            ({row.cases[0]})
          </span>
        </p>
        <p className="text-sm font-medium text-heading">
          <span aria-hidden="true" className="mr-1 text-muted">
            ↔
          </span>
          <span className="sr-only">and </span>
          {row.b}{' '}
          <span className="numeric text-xs font-normal text-muted">
            ({row.cases[1]})
          </span>
        </p>
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={row.naive_status} />
        <p className="mt-1.5 text-sm text-body">
          <ChainLine chain={row.naive_chain} />
        </p>
        <p className="numeric mt-1 text-xs text-muted">
          {plural(row.naive_support.documents, 'document')} counted as
          independent · {plural(row.naive_support.records, 'record')} ·{' '}
          {plural(row.naive_support.claims, 'claim')}
        </p>
      </td>
      <td className="px-3 py-3">
        {row.ours ? (
          <>
            <StatusBadge status={row.ours.status} />
            <p className="mt-1.5 text-sm text-body">
              {row.ours.headline ? (
                <ChainLine chain={row.ours.headline.chain} />
              ) : (
                'No chain within the search scope'
              )}
            </p>
            {ours && (
              <p className="numeric mt-1 text-xs text-muted">
                {plural(ours.counts.documents, 'document')} ·{' '}
                {plural(ours.counts.origins, 'origin')} ·{' '}
                {plural(ours.counts.records, 'record')} ·{' '}
                {plural(ours.counts.claims, 'claim')}
              </p>
            )}
            <Link
              to={`/findings?f=${encodeURIComponent(row.ours.key)}&tab=evidence`}
              className="mt-1.5 inline-block text-xs font-semibold text-body transition-colors hover:text-primary"
            >
              Open finding →
            </Link>
          </>
        ) : (
          <>
            <StatusBadge status="unsupported" />
            <p className="mt-1.5 text-sm text-body">
              Not a finding: no route under this workspace's rules.
            </p>
          </>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {diff.missing && <Chip tone="signal">Not found here</Chip>}
          {diff.status && !diff.missing && (
            <Chip tone="signal">Status differs</Chip>
          )}
          {diff.route && <Chip tone="lead">Route differs</Chip>}
          {!diff.status && !diff.route && !diff.missing && (
            <Chip tone="muted">Same reading</Chip>
          )}
        </div>
      </td>
    </tr>
  )
}
