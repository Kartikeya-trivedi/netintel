/** Typed client for the investigation layer (backend/app/investigation).
 *
 * Mirrors the dictionaries built in backend/app/investigation/service.py and
 * router.py. Keep the two in sync.
 *
 * Every call names the acting principal in X-Principal. That header is a demo
 * stand-in for authentication and the UI labels it as such; nothing here
 * pretends it is a login.
 */

import { ApiError } from './client'

const BASE = import.meta.env.VITE_API_BASE ?? ''
const STATIC = import.meta.env.MODE === 'static'
const PRINCIPAL_KEY = 'netintel.principal'
export const DEFAULT_PRINCIPAL = 'inspector.rao'

export function getPrincipal(): string {
  try {
    return window.localStorage.getItem(PRINCIPAL_KEY) || DEFAULT_PRINCIPAL
  } catch {
    return DEFAULT_PRINCIPAL
  }
}

export function setPrincipal(handle: string): void {
  try {
    window.localStorage.setItem(PRINCIPAL_KEY, handle)
  } catch {
    // Private windows can refuse storage; the choice then lasts the session.
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  if (STATIC) {
    throw new ApiError(503, 'The findings workspace needs the live backend; this preview is read-only.')
  }
  const headers = new Headers(init.headers)
  headers.set('X-Principal', getPrincipal())
  const response = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      detail = await response.text().catch(() => response.statusText)
    }
    throw new ApiError(response.status, detail || response.statusText)
  }
  return response
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, init)).json() as Promise<T>
}

function post<T>(path: string, body: unknown): Promise<T> {
  return json<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// --- Shared vocabulary -------------------------------------------------------

export type Status = 'supported' | 'lead' | 'unsupported'
export type Kind = 'record' | 'claim'
export type Predicate = 'HOLDS' | 'CONTACT' | 'TRANSFER' | 'LINK' | 'ACCUSED'
export type EdgeType = 'CALLED' | 'PAID' | 'CLAIMED' | 'SAME_AS'
export type ReviewState = 'accepted' | 'disputed' | 'rejected'
export type IdentityState = 'accepted' | 'rejected' | 'deferred'

export interface Person {
  key: string
  label: string
  case: string
  case_name: string
  hub: boolean
  accused: boolean
}

export interface Counts {
  observations: number
  documents: number
  origins: number
  records: number
  claims: number
}

export interface Chain {
  key: string
  status: Status
  chain: string[]
}

export interface Family {
  key: string
  origin: string
  documents: string[]
  /** Case codes of the documents the family holds statements from. */
  cases: string[]
  label: string
}

export interface DocumentRef {
  id: number
  filename: string
  case: string
  kind: string
  source_org: string | null
}

export interface Lineage {
  basis: 'declared_reference' | 'near_verbatim' | 'same_event'
  status: 'confirmed' | 'proposed' | 'accepted' | 'rejected'
  link: string
  origin_document: string | null
  note: string
}

/** One statement from one row or passage of an original. */
export interface Evidence {
  key: string
  kind: Kind
  predicate: Predicate
  summary: string
  text: string
  locator: { kind?: string; row?: number; line?: number; start?: number; end?: number; key?: string }
  /** Statements from one row or sentence share a passage and are reviewed together. */
  passage: string
  document: DocumentRef | null
  time: string | null
  family: string | null
  lineage: Lineage | null
  review: ReviewState | 'proposed' | null
  active: boolean
}

/** Lookup tables a response refers into by key. */
export interface Tables {
  people: Record<string, Person>
  evidence: Record<string, Evidence>
  families: Record<string, Family>
}

// --- Workspace ----------------------------------------------------------------

export interface Me {
  handle: string
  name: string
  role: string
  grants: { case_id: number; code: string; case_name: string | null; purpose: string; expires_at: string | null }[]
  demo_identity: boolean
}

export interface PrincipalInfo {
  handle: string
  name: string
  role: string
}

export interface WorkspaceListItem {
  id: number
  name: string
  purpose: string
  version: number
  case_count: number
}

export interface Workspace {
  id: number
  name: string
  purpose: string
  version: number
  created_at: string
  cases: { id: number; code: string; name: string; agency: string | null }[]
  counts: {
    originals: number
    statements: number
    people: number
    relationships: number
    source_links: number
    identity_candidates: number
    conflicts: number
    findings: number
  }
  demo_identity: boolean
}

// --- Findings -------------------------------------------------------------------

export interface FindingSummary {
  key: string
  title: string
  status: Status
  a: Person
  b: Person
  case_a: string
  case_b: string
  distance: number
  explanation_count: number
  supported_explanations: number
  paths_found: number
  truncated: boolean
  headline: Chain | null
  counts: Counts
  assumptions: { provisional_identities: number; hubs: number }
  next_task?: { key: string; title: string; kind: TaskKind } | null
}

export interface Derivation {
  /** Evidence keys that must all hold for this derivation to hold. */
  evidence: string[]
  /** Identity candidates this derivation assumes. */
  identity: string[]
  contested: boolean
}

export interface EdgeOut {
  key: string
  type: EdgeType
  source: string
  target: string
  directed: boolean
  provisional: boolean
  derivations: Derivation[]
  derivation_count: number
  counts: Counts
  contested: boolean
}

export interface Step {
  index: number
  source: string
  target: string
  identity: boolean
  provisional: boolean
  edges: EdgeOut[]
  contested: boolean
}

export interface Explanation extends Chain {
  hops: number
  nodes: string[]
  steps: Step[]
  provisional: string[]
  hubs: string[]
  alternatives: number
  counts: Counts
  families: string[]
  contested: boolean
}

export interface Contrary {
  kind: 'attribution' | 'denial'
  identifier?: string
  events?: number
  from?: string
  to?: string
  holders: string[]
  evidence: string[]
}

export interface CandidateOut {
  key: string
  a: string
  b: string
  name_match: boolean
  status: 'proposed' | IdentityState
  provisional: boolean
  in_effect: boolean
  shared: { identifier: string; overlapping: boolean; evidence: string[] }[]
}

export interface TimelineEvent {
  key: string
  type: 'call' | 'transfer'
  identifier_type: 'phone' | 'account'
  at: string
  from: string
  to: string
  amount: number | null
  document: string | null
  readings: { source: string; target: string }[]
}

export interface TimelineHolding {
  key: string
  identifier: string
  identifier_type: 'phone' | 'account'
  /** Includes the case code, e.g. "Sameer Khan (BM-1)". */
  person: string
  kind: Kind
  /** -1 for a denial of use; never drawn as a holding. */
  polarity: number
  start: string | null
  end: string | null
  stated: string | null
  document: string | null
  active: boolean
}

export interface ScenarioDefinition {
  exclude_families: string[]
  identity: Record<string, 'accepted' | 'rejected'>
  assertions: Record<string, ReviewState>
  groupings: Record<string, 'accepted' | 'rejected'>
  claim_window_days: number
  provisional_identities: boolean
  max_hops: number
  naive: boolean
}

export interface FindingDetail extends FindingSummary, Tables {
  /** The workspace decision version this detail was computed at. */
  version: number
  explanations: Explanation[]
  contrary: Contrary[]
  candidates: CandidateOut[]
  timeline: {
    events: TimelineEvent[]
    holdings: TimelineHolding[]
    range: [string, string] | null
    claim_window_days: number
  }
  scenario: ScenarioDefinition
  tasks: Task[]
  history: { version: number; reason: string; actor: string; at: string; status: Status }[]
}

export interface Sensitivity {
  finding: string
  status: Status
  limits: {
    max_set_size: number
    units_searched: number
    units_total: number
    exhaustive: boolean
    evaluations: number
    max_hops: number
    claim_window_days: number
  }
  breaking: { families: Family[]; status: Status }[]
  downgrading: { families: Family[]; status: Status }[]
  critical: Family[]
  alternatives: { kind: 'identity' | 'attribution'; subject: string; label: string; status: Status; changes: boolean }[]
}

// --- Verification -----------------------------------------------------------------

export type TaskKind = 'attribution' | 'identity' | 'lineage' | 'critical_source'

/** What prompts a check; the first component of its priority. */
export type TaskGrounds = 'contradiction' | 'unreviewed assumption' | 'single-source dependency'

export interface Task {
  key: string
  kind: TaskKind
  grounds: TaskGrounds
  title: string
  question: string
  evidence: { key: string; summary: string; kind: Kind; document: string | null }[]
  effort: number
  availability: string
  status_changes: number
  explanation_changes: number
  affected: { key: string; title: string }[]
  outcomes: {
    key: string
    label: string
    overrides: Partial<ScenarioDefinition>
    changes: { finding: string; title: string; from: Status; to: Status }[]
  }[]
}

// --- Challenge ----------------------------------------------------------------------

export interface FamilyListItem extends Family {
  statements: number
  kinds: Kind[]
}

export interface LineageLink {
  key: string
  basis: Lineage['basis']
  status: string
  proposed_status: string
  score: number | null
  note: string
  derivative: { assertion: string; summary: string; document: string }
  origin: { assertion: string; summary: string; document: string }
}

export interface ScenarioResult {
  findings: {
    key: string
    title: string
    before: Status
    after: Status
    changed: boolean
    explanations: { kept: Chain[]; lost: Chain[]; gained: Chain[] }
  }[]
  edges: { removed: number; added: number; weakened: number }
  people: { removed: string[]; added: string[] }
  conflicts: { before: number; after: number }
  active_assertions: { before: number; after: number }
}

export interface ScenarioRun {
  id: number
  name: string
  status: 'queued' | 'running' | 'complete' | 'failed' | 'stale'
  definition: ScenarioDefinition
  baseline_version: number
  current_version: number
  result: ScenarioResult | null
  error: string | null
  created_at: string
}

export interface Contrast {
  rules: string[]
  findings: {
    a: string
    b: string
    cases: string[]
    naive_status: Status
    naive_chain: string[]
    naive_support: { documents: number; records: number; claims: number }
    ours: { key: string; status: Status; headline: Chain | null } | null
  }[]
}

export interface Artifact {
  id: number
  case: string
  case_name: string
  filename: string
  kind: string
  source_org: string | null
  sha256: string
  bytes: number
  document_date: string | null
  reference: string | null
  source_reference: string | null
  received_at: string
  integrity: 'intact' | 'missing' | 'altered'
}

export interface ArtifactDetail extends Artifact {
  text: string | null
  items: { locator_key: string; locator: Evidence['locator']; content: string; assertions: string[] }[]
}

export interface History {
  snapshots: {
    version: number
    reason: string
    actor: string
    at: string
    statuses: Record<string, Status>
    titles: Record<string, string>
  }[]
  decisions: { type: string; target: string; state: string; reason: string; actor: string | null; version: number; at: string }[]
}

export interface VerifyReport {
  integrity: 'verified' | 'failed' | 'unchecked'
  reproduction: 'reproduced' | 'mismatch' | 'not possible' | 'not requested'
  checks: { check: string; ok: boolean | null; detail: string }[]
  finding: string | null
  title: string | null
  status: string | null
  exported_at: string | null
  scope: string
}

// --- Calls -------------------------------------------------------------------------------

const ws = (id: number) => `/api/workspaces/${id}`

export const inv = {
  me: () => json<Me>('/api/me'),
  principals: () => json<PrincipalInfo[]>('/api/principals'),
  workspaces: () => json<WorkspaceListItem[]>('/api/workspaces'),
  createWorkspace: (caseIds: number[], purpose: string, name: string) =>
    post<Workspace>('/api/workspaces', { case_ids: caseIds, purpose, name }),
  workspace: (id: number) => json<Workspace>(ws(id)),

  findings: (id: number) => json<FindingSummary[]>(`${ws(id)}/findings`),
  finding: (id: number, key: string) => json<FindingDetail>(`${ws(id)}/findings/${key}`),
  sensitivity: (id: number, key: string) => json<Sensitivity>(`${ws(id)}/findings/${key}/sensitivity`),
  tasks: (id: number) => json<Task[]>(`${ws(id)}/tasks`),
  contrast: (id: number) => json<Contrast>(`${ws(id)}/contrast`),
  families: (id: number) => json<FamilyListItem[]>(`${ws(id)}/families`),
  lineage: (id: number) => json<LineageLink[]>(`${ws(id)}/lineage`),
  candidates: (id: number) => json<{ candidates: CandidateOut[] } & Tables>(`${ws(id)}/candidates`),
  artifacts: (id: number) => json<Artifact[]>(`${ws(id)}/artifacts`),
  artifact: (id: number, artifactId: number) => json<ArtifactDetail>(`${ws(id)}/artifacts/${artifactId}`),
  history: (id: number) => json<History>(`${ws(id)}/history`),

  runScenario: (id: number, name: string, definition: Partial<ScenarioDefinition>) =>
    post<ScenarioRun>(`${ws(id)}/scenarios`, { name, definition }),
  scenarios: (id: number) => json<ScenarioRun[]>(`${ws(id)}/scenarios`),

  decideIdentity: (
    id: number,
    body: { candidate: string; state: IdentityState; evidence: string[]; reason: string; expected_version: number },
  ) => post<{ version: number }>(`${ws(id)}/decisions/identity`, body),
  reviewAssertion: (
    id: number,
    body: { assertion: string; state: ReviewState; reason: string; expected_version: number; whole_passage?: boolean },
  ) => post<{ version: number }>(`${ws(id)}/decisions/assertion`, body),
  decideGrouping: (
    id: number,
    body: { link: string; state: 'accepted' | 'rejected'; reason: string; expected_version: number },
  ) => post<{ version: number }>(`${ws(id)}/decisions/grouping`, body),
  /** Record what checking a task found. Every decision it implies lands as one version. */
  recordOutcome: (
    id: number,
    task: string,
    body: { outcome: string; reason: string; expected_version: number },
  ) => post<{ version: number }>(`${ws(id)}/tasks/${task}/record`, body),

  /** Downloads the signed package as a Blob, with the filename the server chose. */
  exportFinding: async (id: number, key: string) => {
    const response = await send(`${ws(id)}/findings/${key}/exports`, { method: 'POST' })
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `netintel-${key}.zip`
    return { blob: await response.blob(), filename }
  },
  publicKey: async () => (await send('/api/receipts/public-key')).text(),
  verifyPackage: (file: File, reproduce: boolean) => {
    const form = new FormData()
    form.append('file', file)
    form.append('reproduce', String(reproduce))
    return json<VerifyReport>('/api/receipts/verify', { method: 'POST', body: form })
  },
  auditChain: () => json<{ intact: boolean; events: number; head: string; broken_at: number | null }>('/api/audit/verify'),

  resetBrokenMirror: () =>
    json<{ workspace_id: number; principal: string }>('/api/demo/broken-mirror/reset', { method: 'POST' }),
}
