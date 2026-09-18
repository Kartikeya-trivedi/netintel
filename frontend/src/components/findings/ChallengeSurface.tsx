import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  inv,
  type FamilyListItem,
  type FindingDetail,
  type ScenarioDefinition,
  type ScenarioRun,
} from '../../api/investigation'
import { errorMessage, formatLocator, plural, shortCaseName } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { ErrorNote, Legend, Segmented, Spinner } from '../Instrument'
import { ActionButton, KindLabel, Note, SectionHeading, Tag } from './Controls'
import { useFindingTables } from './FindingTables'
import ScenarioComparison from './ScenarioComparison'
import SensitivityPanel from './SensitivityPanel'
import {
  CANDIDATE_STATUS,
  baselineDefinition,
  candidateText,
  describeScenario,
  passages,
  sentence,
  withOverrides,
} from './model'

/** Surface 3: challenge the finding.
 *
 *  Everything here is hypothetical. A scenario recomputes every finding in
 *  the workspace under changed assumptions and records nothing in the case
 *  file; recorded decisions live on the Review surface. The builder starts
 *  from the assumptions the baseline was computed under, and a run's result
 *  is only ever shown beside the baseline it was computed against.
 */

export interface ScenarioPreset {
  id: number
  name: string
  overrides: Partial<ScenarioDefinition>
}

type RunState =
  | { status: 'idle' }
  | { status: 'running'; name: string }
  | { status: 'done'; run: ScenarioRun }
  | { status: 'error'; name: string; message: string }

const HOPS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))

export default function ChallengeSurface({
  detail,
  workspaceId,
  scope,
  revision,
  version,
  cases,
  preset,
  onTry,
}: {
  detail: FindingDetail
  workspaceId: number
  scope: string
  revision: number
  version: number | null
  cases: { code: string; name: string }[]
  preset: ScenarioPreset | null
  onTry: (name: string, overrides: Partial<ScenarioDefinition>) => void
}) {
  const { evidence, people, artifacts } = useFindingTables()
  const baseline = useMemo(() => baselineDefinition(detail.scenario), [detail.scenario])
  const [draft, setDraft] = useState<ScenarioDefinition>(baseline)
  const [name, setName] = useState('')
  const [runState, setRunState] = useState<RunState>({ status: 'idle' })
  const [onlyUsed, setOnlyUsed] = useState(false)
  const generation = useRef(0)
  const resultRef = useRef<HTMLDivElement>(null)
  const nameId = useId()
  const windowId = useId()

  const families = useScopedAsync(() => inv.families(workspaceId), scope, [revision])
  const familyLabel = useCallback(
    (key: string) =>
      families.data?.find((family) => family.key === key)?.label ?? detail.families[key]?.label ?? key,
    [families.data, detail.families],
  )
  const autoName = sentence(describeScenario(draft, baseline, familyLabel), 'Baseline assumptions')

  const execute = useCallback(
    async (definition: ScenarioDefinition, label: string) => {
      const current = ++generation.current
      setRunState({ status: 'running', name: label })
      // In one column the result sits below a long form; bring it into view.
      resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      try {
        const run = await inv.runScenario(workspaceId, label, definition)
        if (current === generation.current) setRunState({ status: 'done', run })
      } catch (error) {
        if (current === generation.current) setRunState({ status: 'error', name: label, message: errorMessage(error) })
      }
    },
    [workspaceId],
  )

  // A preset (from the sensitivity panel or a review task) replaces the draft
  // with the baseline plus its overrides, and runs straight away.
  useEffect(() => {
    if (!preset) return
    const next = withOverrides(baseline, preset.overrides)
    setDraft(next)
    setName(preset.name)
    void execute(next, preset.name)
    // Keyed on the preset alone: re-running on every baseline refresh would
    // repeat a scenario nobody asked for again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  // Claims (and any record a conflict names) can be disputed hypothetically,
  // a passage at a time, the way a recorded review would apply.
  const passageOptions = useMemo(() => {
    const contraryKeys = new Set(detail.contrary.flatMap((item) => item.evidence))
    const keys = Object.values(evidence)
      .filter((item) => item.kind === 'claim' || contraryKeys.has(item.key))
      .map((item) => item.key)
    return passages(keys, evidence).sort((a, b) =>
      (a.lead?.document?.filename ?? '').localeCompare(b.lead?.document?.filename ?? ''),
    )
  }, [detail.contrary, evidence])

  const listedAssertions = useMemo(() => new Set(passageOptions.flatMap((p) => p.members)), [passageOptions])
  const strayAssertions = Object.keys(draft.assertions).filter((key) => !listedAssertions.has(key))
  const strayGroupings = Object.keys(draft.groupings)

  // The families the explanations draw on; the response tables also carry
  // families that only identity or conflict evidence mentions.
  const usedFamilies = useMemo(
    () => new Set(detail.explanations.flatMap((explanation) => explanation.families)),
    [detail.explanations],
  )
  const groupedFamilies = useMemo(() => {
    const byCase = new Map<string, FamilyListItem[]>()
    for (const family of families.data ?? []) {
      if (onlyUsed && !usedFamilies.has(family.key)) continue
      const code =
        artifacts?.get(family.origin)?.case ??
        family.documents.map((doc) => artifacts?.get(doc)?.case).find(Boolean) ??
        'Other'
      const list = byCase.get(code) ?? []
      list.push(family)
      byCase.set(code, list)
    }
    return [...byCase.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [artifacts, families.data, onlyUsed, usedFamilies])

  const changes = describeScenario(draft, baseline, familyLabel)
  const running = runState.status === 'running'

  function toggleFamily(key: string) {
    setDraft((current) => ({
      ...current,
      exclude_families: current.exclude_families.includes(key)
        ? current.exclude_families.filter((item) => item !== key)
        : [...current.exclude_families, key],
    }))
  }

  function setIdentity(key: string, value: 'recorded' | 'accepted' | 'rejected') {
    setDraft((current) => {
      const identity = { ...current.identity }
      if (value === 'recorded') delete identity[key]
      else identity[key] = value
      return { ...current, identity }
    })
  }

  function togglePassage(members: string[], on: boolean) {
    setDraft((current) => {
      const assertions = { ...current.assertions }
      for (const key of members) {
        if (on) assertions[key] = 'disputed'
        else delete assertions[key]
      }
      return { ...current, assertions }
    })
  }

  function clearStray() {
    setDraft((current) => {
      const assertions = { ...current.assertions }
      for (const key of strayAssertions) delete assertions[key]
      return { ...current, assertions, groupings: {} }
    })
  }

  return (
    <div className="space-y-8">
      <SensitivityPanel
        workspaceId={workspaceId}
        findingKey={detail.key}
        scope={scope}
        revision={revision}
        onTry={onTry}
      />

      <section className="space-y-3">
        <SectionHeading title="Scenario">
          Change the assumptions and recompute every finding in the workspace. Nothing here is recorded in the
          case file; runs are kept in the audit log. To record a decision, use Review.
        </SectionHeading>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!running) void execute(draft, name.trim() || autoName)
            }}
            className="space-y-5"
          >
            <fieldset className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <legend className="legend">Source families to exclude</legend>
                <label className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
                  <input
                    type="checkbox"
                    checked={onlyUsed}
                    onChange={(event) => setOnlyUsed(event.target.checked)}
                    className="accent-signal"
                  />
                  Only those this finding uses
                </label>
              </div>
              {families.loading && !families.data && <Spinner label="Reading source families" />}
              {families.error && <ErrorNote message={families.error} />}
              {groupedFamilies.map(([code, list]) => {
                const known = cases.find((item) => item.code === code)
                return (
                  <div key={code}>
                    <p className="mb-1 flex items-baseline gap-2">
                      <span className="readout text-[11px] text-ink-200">{code}</span>
                      {known && <span className="text-[11.5px] text-ink-500">{shortCaseName(known.name, code)}</span>}
                    </p>
                    <ul className="divide-y divide-rule border hairline">
                      {list.map((family) => {
                        const checked = draft.exclude_families.includes(family.key)
                        return (
                          <li key={family.key}>
                            <label
                              className={`flex cursor-pointer items-start gap-2.5 px-2.5 py-1.5 transition-colors ${
                                checked ? 'bg-signal/10' : 'tint-hover'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleFamily(family.key)}
                                className="mt-0.5 accent-signal"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block break-all font-mono text-[11.5px] text-ink-100">{family.label}</span>
                                <span className="block text-[11px] text-ink-500">
                                  {plural(family.documents.length, 'document')} · {plural(family.statements, 'statement')} ·{' '}
                                  {family.kinds.length ? family.kinds.map((kind) => `${kind}s`).join(' and ') : 'kind not stated'}
                                </span>
                              </span>
                              {usedFamilies.has(family.key) && <Tag tone="neutral">Used here</Tag>}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
              {families.data && groupedFamilies.length === 0 && (
                <p className="text-[12px] text-ink-500">No source families to list.</p>
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="legend">Identities this finding assumes</legend>
              {detail.candidates.length === 0 ? (
                <p className="text-[12px] text-ink-500">None: this finding joins no case references by identity.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.candidates.map((candidate) => (
                    <li key={candidate.key} className="border hairline px-2.5 py-2">
                      <p className="text-[12.5px] text-ink-100">{candidateText(candidate, people)}</p>
                      <p className="mb-1.5 text-[11px] text-ink-500">Now: {CANDIDATE_STATUS[candidate.status]}</p>
                      <Segmented
                        options={[
                          { value: 'recorded' as const, label: 'As recorded' },
                          { value: 'accepted' as const, label: 'Same person' },
                          { value: 'rejected' as const, label: 'Different people' },
                        ]}
                        value={draft.identity[candidate.key] ?? 'recorded'}
                        onChange={(value) => setIdentity(candidate.key, value)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="legend">Passages to dispute</legend>
              <p className="text-[11.5px] text-ink-500">
                Claims in this finding, and any record a conflict names. Disputing a passage disputes every
                statement read from it.
              </p>
              {passageOptions.length === 0 ? (
                <p className="text-[12px] text-ink-500">No claims in this finding.</p>
              ) : (
                <ul className="divide-y divide-rule border hairline">
                  {passageOptions.map((passage) => {
                    const on = passage.members.every((key) => draft.assertions[key] === 'disputed')
                    const lead = passage.lead
                    return (
                      <li key={passage.key}>
                        <label
                          className={`flex cursor-pointer items-start gap-2.5 px-2.5 py-1.5 transition-colors ${
                            on ? 'bg-signal/10' : 'tint-hover'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(event) => togglePassage(passage.members, event.target.checked)}
                            className="mt-0.5 accent-signal"
                          />
                          {lead && <KindLabel kind={lead.kind} />}
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] text-ink-100">{lead?.summary ?? passage.members[0]}</span>
                            <span className="block font-mono text-[10.5px] text-ink-500">
                              {lead?.document?.filename ?? 'original not named'} · {formatLocator(lead?.locator)}
                              {passage.members.length > 1 && ` · ${plural(passage.members.length, 'statement')}`}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
              {(strayAssertions.length > 0 || strayGroupings.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-400">
                  <span>
                    Also in this scenario from a preset:{' '}
                    {[
                      strayAssertions.length ? plural(strayAssertions.length, 'statement disputed', 'statements disputed') : '',
                      strayGroupings.length ? plural(strayGroupings.length, 'source grouping overridden', 'source groupings overridden') : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    .
                  </span>
                  <ActionButton variant="link" onClick={clearStray}>
                    Clear them
                  </ActionButton>
                </div>
              )}
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="sr-only">Search settings</legend>
              <div>
                <label htmlFor={windowId} className="legend">
                  Claim window
                </label>
                <div className="mt-1.5 flex items-center gap-3">
                  <input
                    id={windowId}
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={draft.claim_window_days}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, claim_window_days: Number(event.target.value) }))
                    }
                    className="min-w-0 flex-1 accent-signal"
                  />
                  <span className="readout w-16 text-right text-[13px] text-ink-100">±{draft.claim_window_days} d</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-500">
                  How far from its stated date a claim may reach. Baseline ±{baseline.claim_window_days} days.
                </p>
              </div>
              <div>
                <span className="legend">Most hops in a chain</span>
                <div className="mt-1.5">
                  <Segmented
                    options={HOPS}
                    value={String(draft.max_hops)}
                    onChange={(value) => setDraft((current) => ({ ...current, max_hops: Number(value) }))}
                  />
                </div>
                <p className="mt-1 text-[11px] text-ink-500">Baseline {baseline.max_hops}.</p>
              </div>
              <label className="flex items-start gap-2 text-[12.5px] text-ink-200 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={draft.provisional_identities}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, provisional_identities: event.target.checked }))
                  }
                  className="mt-0.5 accent-signal"
                />
                <span>
                  Include unconfirmed identities
                  <span className="block text-[11px] text-ink-500">
                    {draft.provisional_identities
                      ? 'On: an unreviewed identity may join case references, and every route through one is a lead.'
                      : 'Off: only identities an analyst accepted may join case references.'}
                  </span>
                </span>
              </label>
            </fieldset>

            <div className="space-y-2 border-t hairline pt-3">
              <p className="text-[12px] text-ink-400">
                <span className="legend mr-2">Changes</span>
                {sentence(changes, 'None yet: this would recompute the baseline as it stands.')}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={nameId} className="legend">
                    Name
                  </label>
                  <input
                    id={nameId}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={autoName}
                    maxLength={200}
                    className="mt-1 block w-full border hairline bg-ink-1000 px-2.5 py-1.5 text-[12.5px] text-ink-100 placeholder:text-ink-700"
                  />
                </div>
                <ActionButton type="submit" variant="primary" disabled={running}>
                  {running ? 'Running…' : 'Run scenario'}
                </ActionButton>
                <ActionButton
                  onClick={() => {
                    setDraft(baseline)
                    setName('')
                  }}
                  disabled={running || changes.length === 0}
                >
                  Reset to baseline
                </ActionButton>
              </div>
            </div>
          </form>

          <div
            ref={resultRef}
            className="min-w-0 scroll-mt-4 space-y-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-8rem)] xl:self-start xl:overflow-y-auto"
          >
            <Legend>Compared with the baseline</Legend>
            {runState.status === 'idle' && (
              <Note>
                Run a scenario, or pick a line in “What this finding needs” above, to see which findings change.
              </Note>
            )}
            {runState.status === 'running' && <Spinner label={`Recomputing: ${runState.name}`} />}
            {runState.status === 'error' && (
              <ErrorNote message={`Scenario “${runState.name}” could not run: ${runState.message}. No result is shown.`} />
            )}
            {runState.status === 'done' && (
              <ScenarioComparison run={runState.run} currentVersion={version} findingKey={detail.key} />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
