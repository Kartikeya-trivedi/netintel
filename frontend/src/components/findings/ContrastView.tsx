import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { inv, type Contrast, type FindingSummary, type Status } from '../../api/investigation'
import { plural } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { ErrorNote, Legend, Spinner } from '../Instrument'
import { ChainLine, LEGEND, Note, SectionHeading, Tag } from './Controls'
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

function differences(row: Row): { status: boolean; route: boolean; missing: boolean } {
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
  const contrast = useScopedAsync(() => inv.contrast(workspaceId), scope, [revision])
  const findings = useScopedAsync(() => inv.findings(workspaceId), scope, [revision])
  const byKey = useMemo(
    () => new Map((findings.data ?? []).map((finding) => [finding.key, finding])),
    [findings.data],
  )

  const rows = contrast.data?.findings ?? []
  const overstated = rows.filter(
    (row) => row.naive_status === 'supported' && (row.ours === null || row.ours.status !== 'supported'),
  )
  const rerouted = rows.filter((row) => {
    const diff = differences(row)
    return diff.route && !diff.status
  })

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <Legend>Contrast</Legend>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink-100">
          What an ordinary resolved graph would report
        </h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-400">
          The same originals, read two ways. On the left, the rules most link-analysis tools apply by default. On the
          right, this workspace. Neither column is a judgement about anyone; the difference is in what each treats
          as evidence of a connection.
        </p>
      </header>

      {contrast.loading && !contrast.data && <Spinner label="Reading both graphs" />}
      {contrast.error && <ErrorNote message={contrast.error} />}

      {contrast.data && (
        <>
          <div className="grid gap-px border hairline gap-fill md:grid-cols-2">
            <div className="bg-ink-1000 px-4 py-3">
              <Legend>An ordinary resolved graph assumes</Legend>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-200">
                {contrast.data.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
            </div>
            <div className="bg-ink-1000 px-4 py-3">
              <Legend>This workspace instead</Legend>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-200">
                {OURS_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
            </div>
          </div>

          {overstated.length > 0 ? (
            <div className="border-l-2 border-signal bg-signal/10 px-4 py-3">
              <p className={`${LEGEND} text-signal`}>Where the ordinary graph overstates</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-100">
                It reports {plural(overstated.length, 'connection')} as supported that this workspace{' '}
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
                    ({row.ours ? statusLabel(row.ours.status) : 'not a finding'})
                  </span>
                ))}
                . An investigation following the ordinary graph would treat {overstated.length === 1 ? 'it' : 'them'} as
                established.
              </p>
            </div>
          ) : (
            <Note>Both readings agree on the status of every pair.</Note>
          )}
          {rerouted.length > 0 && (
            <p className="text-[12.5px] leading-relaxed text-ink-400">
              {plural(rerouted.length, 'pair')} agree on status but not on the route:{' '}
              {rerouted
                .map((row) => `${row.a} ↔ ${row.b} runs ${row.naive_chain.join(' → ')} in the ordinary graph`)
                .join('; ')}
              .
            </p>
          )}

          <section className="space-y-3">
            <SectionHeading title={`Accused pairs · ${rows.length}`}>
              The ordinary graph counts documents as independent sources. This workspace also counts origins: copies
              and repeats of one source count once.
            </SectionHeading>
            <div className="relative overflow-x-auto border hairline">
              <table className="w-full min-w-[820px] text-left">
                <thead className="border-b hairline bg-ink-950">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      <Legend>Accused pair</Legend>
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <Legend>Ordinary resolved graph</Legend>
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <Legend>This workspace</Legend>
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <Legend>Difference</Legend>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((row) => (
                    <ContrastRow key={`${row.a}-${row.b}`} row={row} ours={row.ours ? byKey.get(row.ours.key) ?? null : null} />
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
    <tr className={`align-top ${flagged ? 'bg-signal/5' : ''}`}>
      <td className={`border-l-2 px-3 py-3 ${flagged ? 'border-l-signal' : 'border-l-transparent'}`}>
        <p className="text-[13px] font-medium text-ink-100">
          {row.a} <span className="readout text-[11px] font-normal text-ink-500">({row.cases[0]})</span>
        </p>
        <p className="text-[13px] font-medium text-ink-100">
          <span aria-hidden="true" className="mr-1 text-ink-500">
            ↔
          </span>
          <span className="sr-only">and </span>
          {row.b} <span className="readout text-[11px] font-normal text-ink-500">({row.cases[1]})</span>
        </p>
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={row.naive_status} />
        <p className="mt-1.5 text-[12.5px] text-ink-200">
          <ChainLine chain={row.naive_chain} />
        </p>
        <p className="readout mt-1 text-[10.5px] text-ink-500">
          {plural(row.naive_support.documents, 'document')} counted as independent · {plural(row.naive_support.records, 'record')} ·{' '}
          {plural(row.naive_support.claims, 'claim')}
        </p>
      </td>
      <td className="px-3 py-3">
        {row.ours ? (
          <>
            <StatusBadge status={row.ours.status} />
            <p className="mt-1.5 text-[12.5px] text-ink-200">
              {row.ours.headline ? <ChainLine chain={row.ours.headline.chain} /> : 'No chain within the search scope'}
            </p>
            {ours && (
              <p className="readout mt-1 text-[10.5px] text-ink-500">
                {plural(ours.counts.documents, 'document')} · {plural(ours.counts.origins, 'origin')} ·{' '}
                {plural(ours.counts.records, 'record')} · {plural(ours.counts.claims, 'claim')}
              </p>
            )}
            <Link
              to={`/findings?f=${encodeURIComponent(row.ours.key)}&tab=evidence`}
              className="mt-1.5 inline-block font-cond text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400 transition-colors hover:text-signal"
            >
              Open finding →
            </Link>
          </>
        ) : (
          <>
            <StatusBadge status="unsupported" />
            <p className="mt-1.5 text-[12.5px] text-ink-400">Not a finding: no route under this workspace's rules.</p>
          </>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {diff.missing && <Tag tone="signal">Not found here</Tag>}
          {diff.status && !diff.missing && <Tag tone="signal">Status differs</Tag>}
          {diff.route && <Tag tone="lead">Route differs</Tag>}
          {!diff.status && !diff.route && !diff.missing && <Tag tone="muted">Same reading</Tag>}
        </div>
      </td>
    </tr>
  )
}
