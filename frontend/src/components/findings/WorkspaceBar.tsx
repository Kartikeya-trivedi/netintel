import { useEffect, useId, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { plural, shortCaseName } from '../../lib/format'
import { useWorkspace } from '../../lib/WorkspaceContext'
import { ErrorNote, Legend } from '../Instrument'
import { ActionButton, RULE } from './Controls'

/** The strip across the top of the findings views: which workspace, why it
 *  exists, which case files it compares, the decision version everything on
 *  screen was computed at, and who is asking.
 *
 *  The identity switcher is labelled for what it is. It sets a request header
 *  the demo server trusts; it is not a login.
 */
export default function WorkspaceBar() {
  const ws = useWorkspace()
  const { search } = useLocation()
  const workspace = ws.workspace
  const selectId = useId()
  const workspaceSelectId = useId()

  return (
    <div className="shrink-0 border-b hairline bg-ink-1000">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 pb-3 pt-3.5 sm:px-5">
        <div className="min-w-0 max-w-2xl">
          <div className="flex items-center gap-2">
            <Legend>Cross-case workspace</Legend>
            {ws.workspaces && ws.workspaces.length > 1 && (
              <>
                <label htmlFor={workspaceSelectId} className="sr-only">
                  Workspace
                </label>
                <select
                  id={workspaceSelectId}
                  value={ws.workspaceId ?? ''}
                  onChange={(event) => ws.selectWorkspace(Number(event.target.value))}
                  className="border hairline bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-ink-200"
                >
                  {ws.workspaces.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <h1 className="mt-1 truncate text-[17px] font-semibold tracking-tight text-ink-100">
            {workspace?.name ?? (ws.workspaceLoading ? 'Opening workspace…' : 'No workspace open')}
          </h1>
          {workspace && (
            <p className="mt-0.5 text-[12.5px] text-ink-400">
              <span className="text-ink-500">Purpose:</span> {workspace.purpose}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          {workspace && (
            <div title="Every decision adds a version. Decisions must name the version they were made on.">
              <Legend>Decision version</Legend>
              <p className="readout mt-1 text-[20px] leading-none text-ink-100">{workspace.version}</p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor={selectId} className="legend">
              Demo identity — no authentication
            </label>
            <select
              id={selectId}
              value={ws.principal}
              onChange={(event) => ws.switchPrincipal(event.target.value)}
              className="min-w-[13rem] border hairline bg-ink-950 px-2 py-1 font-mono text-xs text-ink-200"
            >
              {ws.principals.map((person) => (
                <option key={person.handle} value={person.handle}>
                  {person.name} · {person.role}
                </option>
              ))}
              {!ws.principals.some((person) => person.handle === ws.principal) && (
                <option value={ws.principal}>{ws.principal}</option>
              )}
            </select>
          </div>

          <DemoControl hasWorkspace={Boolean(workspace)} />

          <nav aria-label="Workspace views" className="inline-flex border hairline">
            <ViewLink to={{ pathname: '/findings', search }} end label="Findings" />
            <ViewLink to={{ pathname: '/findings/contrast', search }} label="Contrast" />
          </nav>
        </div>
      </div>

      {workspace && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t hairline px-4 py-2 sm:px-5">
          <ul className="flex flex-wrap gap-1.5" aria-label="Case files compared">
            {workspace.cases.map((item) => (
              <li
                key={item.id}
                title={item.agency ?? undefined}
                className="flex items-baseline gap-1.5 border hairline bg-ink-950 px-2 py-0.5"
              >
                <span className="readout text-[11px] text-ink-100">{item.code}</span>
                <span className="text-[12px] text-ink-400">{shortCaseName(item.name, item.code)}</span>
              </li>
            ))}
          </ul>
          <p className="readout text-[10.5px] text-ink-500">
            {plural(workspace.counts.originals, 'original')} · {plural(workspace.counts.statements, 'statement')} ·{' '}
            {plural(workspace.counts.people, 'person', 'people')} · {plural(workspace.counts.identity_candidates, 'identity candidate')} ·{' '}
            {plural(workspace.counts.conflicts, 'attribution conflict')} · {plural(workspace.counts.findings, 'finding')}
          </p>
        </div>
      )}

      <DemoStatus />
      {ws.workspaceError && (
        <div className="border-t hairline px-4 py-2 sm:px-5">
          <ErrorNote message={ws.workspaceError} />
        </div>
      )}
    </div>
  )
}

function ViewLink({
  to,
  label,
  end = false,
}: {
  to: { pathname: string; search: string }
  label: string
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `px-2.5 py-1 font-cond text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
          isActive ? 'bg-signal text-ink-1000' : 'text-ink-500 hover:bg-ink-900 hover:text-ink-200'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

/** Load or reset Operation Broken Mirror. A reset throws away every recorded
 *  decision, so it asks once more before doing it. */
function DemoControl({ hasWorkspace }: { hasWorkspace: boolean }) {
  const { demo, loadDemo } = useWorkspace()
  const [confirming, setConfirming] = useState(false)

  if (demo.busy) {
    return (
      <ActionButton disabled aria-busy="true">
        Loading demo…
      </ActionButton>
    )
  }
  if (!hasWorkspace) {
    return (
      <ActionButton variant="primary" onClick={() => void loadDemo()}>
        Load demo
      </ActionButton>
    )
  }
  if (confirming) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label="Confirm demo reset">
        <ActionButton
          variant="danger"
          onClick={() => {
            setConfirming(false)
            void loadDemo()
          }}
        >
          Reset — discards every decision
        </ActionButton>
        <ActionButton variant="link" onClick={() => setConfirming(false)}>
          Cancel
        </ActionButton>
      </div>
    )
  }
  return <ActionButton onClick={() => setConfirming(true)}>Reset demo</ActionButton>
}

/** Progress for the reload (about five seconds, with nothing to measure), and
 *  what happened when it finished. */
function DemoStatus() {
  const { demo, dismissDemoNotice } = useWorkspace()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!demo.busy) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [demo.busy])

  if (demo.busy) {
    const elapsed = demo.startedAt ? Math.max(0, (now - demo.startedAt) / 1000) : 0
    return (
      <div role="status" className="border-t hairline px-4 py-2 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-200">
            Loading Operation Broken Mirror: preserving the originals, extracting statements, computing findings
          </span>
          <span className="readout text-[11px] text-ink-500">{elapsed.toFixed(1)} s</span>
        </div>
        <div className="mt-1.5 h-[3px] overflow-hidden bg-ink-900">
          <div className="indeterminate h-full w-2/5 bg-signal" />
        </div>
      </div>
    )
  }
  if (demo.error) {
    return (
      <div className="flex items-start gap-3 border-t hairline px-4 py-2 sm:px-5">
        <div className="min-w-0 flex-1">
          <ErrorNote message={`The demo did not load: ${demo.error}`} />
        </div>
        <ActionButton variant="link" onClick={dismissDemoNotice}>
          Dismiss
        </ActionButton>
      </div>
    )
  }
  if (demo.notice) {
    return (
      <div className={`flex items-center justify-between gap-3 border-t ${RULE} bg-status-lead/10 px-4 py-2 sm:px-5`}>
        <p role="status" className="text-[12.5px] text-ink-200">
          {demo.notice}
        </p>
        <ActionButton variant="link" onClick={dismissDemoNotice}>
          Dismiss
        </ActionButton>
      </div>
    )
  }
  return null
}
