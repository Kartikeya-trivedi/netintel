import type {
  Family,
  ScenarioDefinition,
  Sensitivity,
} from '../../api/investigation'
import { inv } from '../../api/investigation'
import { plural } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { ErrorNote, FieldLabel, LoadingState } from '../../ui'
import { Button, LABEL, Callout, SectionHeading } from './shared'
import { useFindingTables } from './FindingTables'
import StatusBadge, { statusLabel } from './StatusBadge'
import { passages } from './model'

/** What this finding needs: which source families it cannot lose, and which
 *  assumptions would change it if they failed.
 *
 *  The search is exhaustive only within stated limits, and the limits line is
 *  printed every time, including when nothing was found: "nothing broke it"
 *  is a statement about what was searched, never about sources nobody has.
 */

export type TryScenario = (
  name: string,
  overrides: Partial<ScenarioDefinition>,
) => void

export function limitsText(limits: Sensitivity['limits']): string {
  const families = limits.units_total === 1 ? 'family' : 'families'
  return [
    `Searched ${limits.units_searched} of the ${limits.units_total} source ${families} behind any route this finding could take,`,
    `every set of up to ${limits.max_set_size} (${plural(limits.evaluations, 'evaluation')}),`,
    `routes within ${limits.max_hops} hops, claims reaching ±${limits.claim_window_days} days.`,
    limits.exhaustive
      ? 'Exhaustive within that scope.'
      : 'Not exhaustive: only the most-used families were combined.',
    'Sources no one has on file are outside any search.',
  ].join(' ')
}

function familyList(families: Family[]): string {
  return families.map((family) => family.label).join(' + ')
}

export default function SensitivityPanel({
  workspaceId,
  findingKey,
  scope,
  revision,
  onTry,
}: {
  workspaceId: number
  findingKey: string
  scope: string
  revision: number
  onTry: TryScenario
}) {
  const { evidence } = useFindingTables()
  const report = useScopedAsync(
    () => inv.sensitivity(workspaceId, findingKey),
    `${scope}|${findingKey}`,
    [revision],
  )
  const data = report.data

  return (
    <section className="space-y-3">
      <SectionHeading
        title="What this finding needs"
        aside={data ? <StatusBadge status={data.status} /> : undefined}
      >
        Source families were withdrawn alone and in combination, and each
        identity and attribution the finding relies on was assumed wrong, under
        the decisions recorded so far; the exact search limits are printed
        below. Try any line as a scenario.
      </SectionHeading>

      {report.loading && !data && (
        <LoadingState label="Searching withdrawal sets" />
      )}
      {report.error && <ErrorNote message={report.error} />}

      {data && (
        <div className="space-y-4">
          <BreakingSets data={data} onTry={onTry} />

          {data.status === 'supported' && data.downgrading.length > 0 && (
            <div>
              <FieldLabel>Withdrawing these would leave it a lead</FieldLabel>
              <ul className="mt-1.5 divide-y divide-border border border-border">
                {data.downgrading.map((set) => (
                  <FamilySetRow
                    key={set.families.map((f) => f.key).join('+')}
                    families={set.families}
                    status={set.status}
                    onTry={onTry}
                  />
                ))}
              </ul>
            </div>
          )}

          <Alternatives
            data={data}
            onTry={(alternative) => {
              if (alternative.kind === 'identity') {
                onTry(alternative.label, {
                  identity: { [alternative.subject]: 'rejected' },
                })
                return
              }
              const passage = passages(Object.keys(evidence), evidence).find(
                (p) => p.members.includes(alternative.subject),
              )
              const keys = passage ? passage.members : [alternative.subject]
              onTry(alternative.label, {
                assertions: Object.fromEntries(
                  keys.map((key) => [key, 'disputed' as const]),
                ),
              })
            }}
          />

          <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted">
            <span className="field-label mr-2">Search limits</span>
            {limitsText(data.limits)}
          </p>
        </div>
      )}
    </section>
  )
}

function BreakingSets({
  data,
  onTry,
}: {
  data: Sensitivity
  onTry: TryScenario
}) {
  const singles = data.breaking.filter((set) => set.families.length === 1)
  const larger = data.breaking.filter((set) => set.families.length > 1)

  if (singles.length > 0) {
    return (
      <div>
        <p className={`${LABEL} text-primary`}>
          Withdrawing any one of these breaks it
        </p>
        <ul className="mt-1.5 divide-y divide-border border border-primary/40">
          {singles.map((set) => (
            <FamilySetRow
              key={set.families[0].key}
              families={set.families}
              status={set.status}
              onTry={onTry}
            />
          ))}
        </ul>
        {larger.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Also found {plural(larger.length, 'larger set')}:{' '}
            {larger.map((set) => familyList(set.families)).join('; ')}.
          </p>
        )}
      </div>
    )
  }

  if (larger.length > 0) {
    return (
      <div>
        <FieldLabel>
          No single source family breaks it; found sets of{' '}
          {larger[0].families.length}
        </FieldLabel>
        <ul className="mt-1.5 divide-y divide-border border border-border">
          {larger.map((set) => (
            <FamilySetRow
              key={set.families.map((f) => f.key).join('+')}
              families={set.families}
              status={set.status}
              onTry={onTry}
            />
          ))}
        </ul>
      </div>
    )
  }

  return (
    <Callout>
      No set of up to {data.limits.max_set_size} source families breaks it
      {data.limits.exhaustive ? '' : ' among the families searched'}.
    </Callout>
  )
}

function FamilySetRow({
  families,
  status,
  onTry,
}: {
  families: Family[]
  status: Sensitivity['status']
  onTry: TryScenario
}) {
  const one = families.length === 1
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <div className="min-w-0 flex-1">
        {families.map((family, index) => (
          <p key={family.key} className="text-sm text-heading">
            {index > 0 && <span className="mr-1.5 field-label">and</span>}
            <span className="font-mono">{family.label}</span>
            {family.documents.length > 1 && (
              <span className="ml-2 text-xs text-muted">
                one origin across {plural(family.documents.length, 'document')}:{' '}
                {family.documents.join(', ')}
              </span>
            )}
          </p>
        ))}
      </div>
      <span className="flex items-center gap-1.5 text-xs text-muted">
        leaves it <StatusBadge status={status} short />
      </span>
      <Button
        onClick={() =>
          onTry(
            one
              ? `Exclude ${families[0].label}`
              : `Exclude ${familyList(families)}`,
            { exclude_families: families.map((family) => family.key) },
          )
        }
      >
        {one ? 'Exclude this origin' : 'Exclude these'}
      </Button>
    </li>
  )
}

function Alternatives({
  data,
  onTry,
}: {
  data: Sensitivity
  onTry: (alternative: Sensitivity['alternatives'][number]) => void
}) {
  const changing = data.alternatives.filter(
    (alternative) => alternative.changes,
  )
  const holding = data.alternatives.filter(
    (alternative) => !alternative.changes,
  )

  return (
    <div>
      <FieldLabel>
        {changing.length > 0
          ? 'Assumptions that change its status if they fail'
          : 'Assumptions checked'}
      </FieldLabel>
      {changing.length > 0 ? (
        <ul className="mt-1.5 divide-y divide-border border border-border">
          {changing.map((alternative) => (
            <li
              key={`${alternative.kind}-${alternative.subject}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
            >
              <span className="field-label w-20 shrink-0">
                {alternative.kind === 'identity' ? 'Identity' : 'Attribution'}
              </span>
              <span className="min-w-0 flex-1 text-sm text-heading">
                If {alternative.label}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted">
                it becomes <StatusBadge status={alternative.status} short />
              </span>
              <Button onClick={() => onTry(alternative)}>Try it</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-body">
          No single identity or attribution failing changes its status.
        </p>
      )}
      {holding.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted hover:text-body">
            {plural(holding.length, 'other assumption')} checked; none changes
            the status ({statusLabel(data.status, true)})
          </summary>
          <ul className="mt-1.5 space-y-1 pl-3 text-xs text-body">
            {holding.map((alternative) => (
              <li key={`${alternative.kind}-${alternative.subject}`}>
                If {alternative.label}: stays{' '}
                {statusLabel(alternative.status, true).toLowerCase()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
