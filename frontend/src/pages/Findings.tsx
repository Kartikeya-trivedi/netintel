import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { inv, type FindingSummary, type History } from '../api/investigation'
import ContrastView from '../components/findings/ContrastView'
import { ActionButton, LEGEND, Note } from '../components/findings/Controls'
import { DecisionProvider, type RecordedDecision } from '../components/findings/DecisionContext'
import FindingDetail, { parseTab, type Tab } from '../components/findings/FindingDetail'
import FindingQueue, { type RetiredFinding } from '../components/findings/FindingQueue'
import StatusBadge from '../components/findings/StatusBadge'
import WorkspaceBar from '../components/findings/WorkspaceBar'
import { EmptyPanel, ErrorNote, Legend, Spinner } from '../components/Instrument'
import { formatDateTime } from '../lib/format'
import { useScopedAsync } from '../lib/useApi'
import { useWorkspace } from '../lib/WorkspaceContext'

/** The investigation workspace: the queue of findings to review, and one
 *  finding opened beside it.
 *
 *  Selection and surface live in the URL (?f=<finding>&tab=<surface>), so any
 *  view of a finding can be linked to or reopened. The static preview build
 *  has no backend to compute findings with, and says so instead of failing.
 */

const STATIC = import.meta.env.MODE === 'static'

export default function Findings({ view = 'queue' }: { view?: 'queue' | 'contrast' }) {
  if (STATIC) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <EmptyPanel
          title="Findings need the live backend"
          action={
            <Link
              to="/graph"
              className="inline-block border hairline px-3 py-1.5 font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-200 transition-colors hover:text-signal"
            >
              Open the network view
            </Link>
          }
        >
          This hosted preview is read-only and has no server to compute cross-case findings, scenarios or signed
          packages. Run the backend locally to use the findings workspace.
        </EmptyPanel>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:min-h-0">
      <WorkspaceBar />
      <WorkspaceBody view={view} />
    </div>
  )
}

function WorkspaceBody({ view }: { view: 'queue' | 'contrast' }) {
  const ws = useWorkspace()

  if (ws.workspacesError && !ws.workspaces && ws.workspacesStatus === 401) {
    // The server does not know this identity. On a fresh database no demo
    // identity exists until the demo is loaded, so this is a first run, not
    // a fault.
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <EmptyPanel
          title={ws.principals.length > 0 ? 'This identity is not known here' : 'No demo identities on this server yet'}
          action={
            <ActionButton variant="primary" disabled={ws.demo.busy} onClick={() => void ws.loadDemo()}>
              {ws.demo.busy ? 'Loading…' : 'Load Operation Broken Mirror'}
            </ActionButton>
          }
        >
          This browser acts as <span className="font-mono">{ws.principal}</span>, which the server does not
          know.{' '}
          {ws.principals.length > 0
            ? 'Pick one of the demo identities above, or reload the demo to start again.'
            : 'Loading the demo creates three synthetic case files, the demo identities and their grants, and a joint workspace to review.'}
        </EmptyPanel>
      </div>
    )
  }
  if (ws.workspacesError && !ws.workspaces) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-6 py-8">
        <ErrorNote message={`The workspace list could not be read: ${ws.workspacesError}`} />
        <ActionButton onClick={ws.refresh}>Try again</ActionButton>
      </div>
    )
  }
  if (!ws.workspaces) {
    return (
      <div className="px-6 py-8">
        <Spinner label="Reading workspaces" />
      </div>
    )
  }
  if (ws.workspaces.length === 0) return <NoWorkspace />
  if (ws.workspaceId === null) return null

  if (view === 'contrast') {
    return (
      <div className="min-h-0 flex-1 lg:overflow-y-auto">
        <ContrastView workspaceId={ws.workspaceId} scope={ws.scope} revision={ws.revision} />
      </div>
    )
  }
  return <FindingsWorkspace workspaceId={ws.workspaceId} />
}

/** No workspace for this identity. Says why, from the identity's own grants,
 *  because "nothing here" and "not allowed to compare these" differ. */
function NoWorkspace() {
  const { me, principal, demo, loadDemo } = useWorkspace()
  const grants = me?.grants ?? []

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <EmptyPanel
        title={`No workspace for ${me?.name ?? principal}`}
        action={
          <ActionButton variant="primary" disabled={demo.busy} onClick={() => void loadDemo()}>
            {demo.busy ? 'Loading…' : 'Load Operation Broken Mirror'}
          </ActionButton>
        }
      >
        A workspace compares case files that an identity may read together, for one stated purpose. This identity
        holds no grant set that opens one.{' '}
        {grants.length > 0
          ? 'Its grants are listed below.'
          : 'It holds no case grants at all.'}{' '}
        Loading the demo creates three synthetic case files and a joint workspace for the demo investigator.
      </EmptyPanel>
      {grants.length > 0 && (
        <div className="mt-4 border hairline">
          <p className="border-b hairline px-3 py-2">
            <Legend>Grants held by {me?.name ?? principal}</Legend>
          </p>
          <ul className="divide-y divide-rule">
            {grants.map((grant) => (
              <li key={`${grant.case_id}-${grant.purpose}`} className="px-3 py-2 text-[12.5px] text-ink-200">
                <span className="readout mr-2 text-ink-100">{grant.code}</span>
                {grant.case_name ?? 'case name withheld'}
                <span className="block text-[11.5px] text-ink-500">
                  Purpose: {grant.purpose}
                  {grant.expires_at ? ` · expires ${formatDateTime(grant.expires_at)}` : ' · no expiry'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Findings that an earlier snapshot showed and the current one does not. */
function retiredFindings(history: History | null, current: FindingSummary[] | null): RetiredFinding[] {
  if (!history || !current) return []
  const live = new Set(current.map((finding) => finding.key))
  const snapshots = [...history.snapshots].sort((a, b) => a.version - b.version)
  const seen = new Map<string, RetiredFinding>()
  for (const snapshot of snapshots) {
    for (const [key, status] of Object.entries(snapshot.statuses)) {
      seen.set(key, {
        key,
        title: snapshot.titles[key] ?? key,
        lastStatus: status,
        lastVersion: snapshot.version,
        since: null,
      })
    }
  }
  const out: RetiredFinding[] = []
  for (const entry of seen.values()) {
    if (live.has(entry.key)) continue
    const after = snapshots.find((snapshot) => snapshot.version > entry.lastVersion)
    out.push({ ...entry, since: after?.version ?? null })
  }
  return out.sort((a, b) => b.lastVersion - a.lastVersion || a.title.localeCompare(b.title))
}

function FindingsWorkspace({ workspaceId }: { workspaceId: number }) {
  const ws = useWorkspace()
  const [params, setParams] = useSearchParams()
  const [recorded, setRecorded] = useState<RecordedDecision | null>(null)

  const findings = useScopedAsync(() => inv.findings(workspaceId), ws.scope, [ws.revision])
  const history = useScopedAsync(() => inv.history(workspaceId), ws.scope, [ws.revision])
  const artifacts = useScopedAsync(() => inv.artifacts(workspaceId), ws.scope, [ws.revision])
  const artifactMap = useMemo(
    () => (artifacts.data ? new Map(artifacts.data.map((artifact) => [artifact.filename, artifact])) : null),
    [artifacts.data],
  )

  const list = findings.data
  const selectedKey = params.get('f')
  const tab = parseTab(params.get('tab'))
  const selected = list?.find((finding) => finding.key === selectedKey) ?? null
  const retired = useMemo(() => retiredFindings(history.data, list), [history.data, list])
  const retiredSelected = !selected && selectedKey ? retired.find((item) => item.key === selectedKey) ?? null : null
  const cases = useMemo(
    () => (ws.workspace?.cases ?? []).map((item) => ({ code: item.code, name: item.name })),
    [ws.workspace],
  )

  // With nothing chosen, open the top of the queue and put it in the URL so
  // the view can be linked to as it stands.
  useEffect(() => {
    if (!list || list.length === 0 || selectedKey) return
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('f', list[0].key)
        return next
      },
      { replace: true },
    )
  }, [list, selectedKey, setParams])

  // A new identity or workspace starts with no notice from the previous one.
  useEffect(() => setRecorded(null), [ws.scope])

  const select = useCallback(
    (key: string) =>
      setParams((current) => {
        const next = new URLSearchParams(current)
        next.set('f', key)
        return next
      }),
    [setParams],
  )

  const setTab = useCallback(
    (surface: Tab) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.set('tab', surface)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  return (
    <DecisionProvider
      workspaceId={workspaceId}
      version={ws.workspace?.version ?? null}
      onRecorded={setRecorded}
      onChanged={ws.refresh}
    >
      {recorded && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-signal/40 bg-signal/10 px-4 py-2 sm:px-5"
        >
          <p className="text-[12.5px] text-ink-200">
            <span className={`${LEGEND} mr-2 text-signal`}>Decision recorded</span>
            Workspace now at version <span className="readout">{recorded.version}</span>
            {' · '}
            {formatDateTime(recorded.at)}. Every finding has been recomputed; the previous version is kept in the
            history.
          </p>
          <ActionButton variant="link" onClick={() => setRecorded(null)}>
            Dismiss
          </ActionButton>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside
          aria-label="Findings queue"
          className="border-b hairline lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-r"
        >
          {findings.error ? (
            <div className="space-y-3 p-4">
              <ErrorNote message={findings.error} />
              <ActionButton onClick={findings.reload}>Try again</ActionButton>
            </div>
          ) : (
            <FindingQueue
              findings={list ?? []}
              retired={retired}
              selectedKey={selectedKey}
              onSelect={select}
              loading={findings.loading}
            />
          )}
        </aside>

        <section aria-label="Selected finding" className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
          {selected ? (
            <FindingDetail
              key={`${ws.scope}|${selected.key}`}
              workspaceId={workspaceId}
              summary={selected}
              tab={tab}
              onTab={setTab}
              scope={ws.scope}
              revision={ws.revision}
              version={ws.workspace?.version ?? null}
              artifacts={artifactMap}
              history={history.data}
              historyLoading={history.loading}
              cases={cases}
            />
          ) : retiredSelected ? (
            <RetiredView item={retiredSelected} history={history.data} onBack={() => list?.[0] && select(list[0].key)} />
          ) : list && list.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyPanel title="Nothing to review">
                No connection between accused in different case files holds under the current decisions and search
                limits.
              </EmptyPanel>
            </div>
          ) : selectedKey && list && !findings.loading ? (
            <div className="px-6 py-10">
              <EmptyPanel
                title="Finding not found"
                action={
                  list[0] && (
                    <ActionButton onClick={() => select(list[0].key)}>Open the top of the queue</ActionButton>
                  )
                }
              >
                No finding <span className="font-mono">{selectedKey}</span> in this workspace for this identity, now or
                in its history.
              </EmptyPanel>
            </div>
          ) : (
            <div className="px-6 py-8">
              <Spinner label="Reading findings" />
            </div>
          )}
        </section>
      </div>
    </DecisionProvider>
  )
}

/** A finding the current decisions no longer support, read from the
 *  workspace's snapshots: it is gone from the queue, not from the record. */
function RetiredView({
  item,
  history,
  onBack,
}: {
  item: RetiredFinding
  history: History | null
  onBack: () => void
}) {
  const snapshots = [...(history?.snapshots ?? [])].sort((a, b) => b.version - a.version)
  return (
    <div className="space-y-5 px-5 py-6 sm:px-6">
      <header className="border-b hairline pb-4">
        <Legend>Finding no longer supported</Legend>
        <h1 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink-100">{item.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status="unsupported" size="md" />
          <span className="text-[12.5px] text-ink-400">
            {item.since !== null
              ? `Since version ${item.since}; it was ${item.lastStatus === 'lead' ? 'a lead' : 'supported'} at version ${item.lastVersion}.`
              : `Last shown at version ${item.lastVersion}.`}
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-ink-400">
          Under the decisions recorded since, no route joins the two within the search scope, so the finding has left
          the queue. It has not been deleted: its earlier versions stay in the history below, and a later decision
          can bring it back.
        </p>
      </header>

      <section className="space-y-2">
        <p className="legend">History</p>
        {snapshots.length === 0 ? (
          <Note>No snapshots available.</Note>
        ) : (
          <ol className="border-l hairline">
            {snapshots.map((snapshot) => {
              const status = snapshot.statuses[item.key] ?? 'unsupported'
              return (
                <li key={snapshot.version} className="relative pb-3 pl-4 last:pb-0">
                  <span aria-hidden="true" className="absolute -left-[4.5px] top-1.5 h-2 w-2 border border-ink-500 bg-ink-1000" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="readout text-[12px] text-ink-100">v{snapshot.version}</span>
                    <StatusBadge status={status} short />
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-200">{snapshot.reason}</p>
                  <p className="text-[11px] text-ink-500">
                    {snapshot.actor} · {formatDateTime(snapshot.at)}
                  </p>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <ActionButton onClick={onBack}>Back to the queue</ActionButton>
    </div>
  )
}
