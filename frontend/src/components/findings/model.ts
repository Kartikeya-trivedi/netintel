import type {
  CandidateOut,
  EdgeType,
  Evidence,
  Explanation,
  Lineage,
  Person,
  ScenarioDefinition,
  Step,
  TaskKind,
  TimelineEvent,
} from '../../api/investigation'
import { plural } from '../../lib/format'

/** Pure helpers behind the findings views: how a response is read, never how
 *  it is drawn. Kept apart so the wording rules live in one place. */

// --- Relationships -------------------------------------------------------------

export const EDGE_GROUPS: { type: EdgeType; title: string; note: string }[] = [
  {
    type: 'CALLED',
    title: 'Calls (records)',
    note: 'Call-detail rows, attributed to people through who held each number at the time.',
  },
  {
    type: 'PAID',
    title: 'Transfers (records)',
    note: 'Bank-statement rows, attributed through who held each account.',
  },
  {
    type: 'CLAIMED',
    title: 'Report claim',
    note: 'A report says the two were in contact. What a source says, not something observed.',
  },
  { type: 'SAME_AS', title: 'Identity link', note: 'Two case references treated as one person.' },
]

export function identityTitle(provisional: boolean): string {
  return provisional ? 'Identity link — unreviewed' : 'Identity link — accepted'
}

/** One stop on a chain. Two case references joined by an identity step read
 *  as one person carrying both case codes, as the chain labels already do. */
export interface ChainToken {
  keys: string[]
  label: string
  cases: string[]
  accused: boolean
  hub: boolean
  identity: { provisional: boolean } | null
}

export interface ChainHop {
  step: Step
  from: number
  to: number
}

export function chainTokens(
  explanation: Explanation,
  people: Record<string, Person>,
): { tokens: ChainToken[]; hops: ChainHop[] } {
  const token = (key: string): ChainToken => {
    const person = people[key]
    return {
      keys: [key],
      label: person?.label ?? key,
      cases: person ? [person.case] : [],
      accused: person?.accused ?? false,
      hub: person?.hub ?? false,
      identity: null,
    }
  }
  const first = explanation.nodes[0] ?? explanation.steps[0]?.source
  const tokens: ChainToken[] = first ? [token(first)] : []
  const hops: ChainHop[] = []
  for (const step of explanation.steps) {
    const last = tokens[tokens.length - 1]
    if (step.identity && last) {
      const person = people[step.target]
      last.keys.push(step.target)
      if (person && !last.cases.includes(person.case)) last.cases.push(person.case)
      last.accused = last.accused || (person?.accused ?? false)
      last.hub = last.hub || (person?.hub ?? false)
      last.identity = { provisional: (last.identity?.provisional ?? false) || step.provisional }
      continue
    }
    tokens.push(token(step.target))
    hops.push({ step, from: tokens.length - 2, to: tokens.length - 1 })
  }
  return { tokens, hops }
}

export function tokenText(token: ChainToken): string {
  const cases = token.cases.join(' / ')
  const identity = token.identity ? (token.identity.provisional ? ', unconfirmed identity' : ', identity accepted') : ''
  return `${token.label} (${cases}${identity})`
}

/** Which directions a hop's edges run, relative to the hop. */
export function hopTypes(step: Step): { type: EdgeType; direction: 'forward' | 'backward' | 'both' | 'none' }[] {
  const seen = new Map<EdgeType, Set<'forward' | 'backward' | 'none'>>()
  for (const edge of step.edges) {
    const set = seen.get(edge.type) ?? new Set()
    if (!edge.directed) set.add('none')
    else if (edge.source === step.source) set.add('forward')
    else set.add('backward')
    seen.set(edge.type, set)
  }
  return [...seen.entries()].map(([type, set]) => ({
    type,
    direction:
      set.has('forward') && set.has('backward')
        ? 'both'
        : set.has('forward')
          ? 'forward'
          : set.has('backward')
            ? 'backward'
            : 'none',
  }))
}

export const EDGE_VERB: Record<EdgeType, string> = {
  CALLED: 'calls',
  PAID: 'transfers',
  CLAIMED: 'report claim',
  SAME_AS: 'same person?',
}

// --- Statements -----------------------------------------------------------------

/** Statements from one sentence or one row are reviewed together: doubting who
 *  used a number in a sentence doubts the rest of that sentence too. This
 *  mirrors the server's own passage rule (same original, same item). */
export function passageKey(evidence: Evidence | undefined, fallback: string): string {
  if (!evidence?.document) return `solo:${fallback}`
  const { locator } = evidence
  const where =
    locator.kind === 'row' || locator.row !== undefined
      ? `row:${locator.row}`
      : locator.start !== undefined
        ? `span:${locator.start}-${locator.end}`
        : `solo:${fallback}`
  return `${evidence.document.id}|${where}`
}

export interface Passage {
  key: string
  members: string[]
  lead: Evidence | null
}

export function passages(keys: string[], evidence: Record<string, Evidence>): Passage[] {
  const grouped = new Map<string, Passage>()
  for (const key of keys) {
    const item = evidence[key]
    const id = passageKey(item, key)
    const entry = grouped.get(id) ?? { key: id, members: [], lead: item ?? null }
    if (!entry.members.includes(key)) entry.members.push(key)
    grouped.set(id, entry)
  }
  return [...grouped.values()]
}

const BASIS: Record<Lineage['basis'], string> = {
  declared_reference: 'declared reference',
  near_verbatim: 'near-verbatim copy',
  same_event: 'same event in another export',
}

const LINEAGE_STATUS: Record<Lineage['status'], string> = {
  confirmed: 'confirmed',
  proposed: 'proposed, not reviewed',
  accepted: 'accepted by an analyst',
  rejected: 'rejected by an analyst',
}

/** "Repeats BM3_informant_tip_GD23.txt — declared reference, confirmed". */
export function lineageText(lineage: Lineage): string {
  const origin = lineage.origin_document ?? 'another original'
  if (lineage.status === 'rejected') {
    return `Counted as independent of ${origin} — ${BASIS[lineage.basis]} grouping rejected by an analyst`
  }
  return `Repeats ${origin} — ${BASIS[lineage.basis]}, ${LINEAGE_STATUS[lineage.status] ?? lineage.status}`
}

export function reviewText(review: Evidence['review']): { text: string; decided: boolean } {
  switch (review) {
    case 'accepted':
      return { text: 'Accepted by analyst', decided: true }
    case 'disputed':
      return { text: 'Disputed by analyst', decided: true }
    case 'rejected':
      return { text: 'Rejected by analyst', decided: true }
    case 'proposed':
      return { text: 'Proposed', decided: false }
    default:
      return { text: 'Not reviewed', decided: false }
  }
}

// --- Events -------------------------------------------------------------------------

/** The API lists one reading per holding pair, so the same pair can repeat. */
export function uniqueReadings(readings: TimelineEvent['readings']): TimelineEvent['readings'] {
  const seen = new Set<string>()
  return readings.filter((reading) => {
    const id = `${reading.source}→${reading.target}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function readingsText(readings: TimelineEvent['readings']): string {
  const unique = uniqueReadings(readings)
  if (unique.length === 0) return 'not read as anyone'
  return unique.map((r) => `${r.source} → ${r.target}`).join('; ')
}

// --- Identity ---------------------------------------------------------------------

export function candidateText(candidate: CandidateOut, people: Record<string, Person>): string {
  const a = people[candidate.a]
  const b = people[candidate.b]
  const left = a ? `${a.label} (${a.case})` : candidate.a
  const right = b ? `${b.label} (${b.case})` : candidate.b
  return `${left} and ${right}`
}

export const CANDIDATE_STATUS: Record<CandidateOut['status'], string> = {
  proposed: 'Proposed, not reviewed',
  accepted: 'Accepted by analyst',
  rejected: 'Rejected by analyst',
  deferred: 'Deferred by analyst',
}

// --- Tasks ----------------------------------------------------------------------------

/** Effort is the task's own stated reading load, phrased per kind of task. */
export const TASK_KIND: Record<TaskKind, { label: string; effort: (n: number) => string }> = {
  attribution: { label: 'Attribution check', effort: (n) => `${plural(n, 'item')} to read` },
  identity: { label: 'Identity check', effort: (n) => `${plural(n, 'item')} to read` },
  lineage: { label: 'Lineage check', effort: (n) => `${plural(n, 'item')} to compare` },
  critical_source: { label: 'Critical source check', effort: (n) => `${plural(n, 'row')} to check` },
}

// --- Scenarios --------------------------------------------------------------------------

export function baselineDefinition(base: ScenarioDefinition): ScenarioDefinition {
  return {
    exclude_families: [],
    identity: {},
    assertions: {},
    groupings: {},
    claim_window_days: base.claim_window_days,
    provisional_identities: base.provisional_identities,
    max_hops: base.max_hops,
    naive: false,
  }
}

export function withOverrides(base: ScenarioDefinition, overrides: Partial<ScenarioDefinition>): ScenarioDefinition {
  return {
    ...base,
    ...overrides,
    exclude_families: overrides.exclude_families ?? base.exclude_families,
    identity: overrides.identity ?? base.identity,
    assertions: overrides.assertions ?? base.assertions,
    groupings: overrides.groupings ?? base.groupings,
    naive: false,
  }
}

/** What a scenario changes relative to the baseline, one phrase per change. */
export function describeScenario(
  draft: ScenarioDefinition,
  base: ScenarioDefinition,
  familyLabel: (key: string) => string,
): string[] {
  const out: string[] = []
  if (draft.exclude_families.length === 1) out.push(`Exclude ${familyLabel(draft.exclude_families[0])}`)
  else if (draft.exclude_families.length > 1) out.push(`Exclude ${draft.exclude_families.length} source families`)
  const identities = Object.values(draft.identity)
  const same = identities.filter((state) => state === 'accepted').length
  const different = identities.filter((state) => state === 'rejected').length
  if (same) out.push(`assume ${same === 1 ? 'one identity' : `${same} identities`} confirmed`)
  if (different) out.push(`assume ${different === 1 ? 'one pair' : `${different} pairs`} are different people`)
  const disputed = Object.keys(draft.assertions).length
  if (disputed) out.push(`dispute ${disputed === 1 ? 'one statement' : `${disputed} statements`}`)
  const groupings = Object.keys(draft.groupings).length
  if (groupings) out.push(`override ${groupings === 1 ? 'one source grouping' : `${groupings} source groupings`}`)
  if (draft.claim_window_days !== base.claim_window_days) out.push(`claims reach ±${draft.claim_window_days} days`)
  if (draft.provisional_identities !== base.provisional_identities) {
    out.push(draft.provisional_identities ? 'include unconfirmed identities' : 'leave out unconfirmed identities')
  }
  if (draft.max_hops !== base.max_hops) out.push(`up to ${draft.max_hops} hops`)
  return out
}

export function sentence(parts: string[], empty: string): string {
  if (parts.length === 0) return empty
  const text = parts.join('; ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
