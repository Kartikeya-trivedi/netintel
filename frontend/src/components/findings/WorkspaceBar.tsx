import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { plural, shortCaseName } from '../../lib/format'
import { useWorkspace } from '../../lib/WorkspaceContext'
import { ErrorNote } from '../../ui'
import { Direction } from '../../ui/Identity'
import { Button, BORDER } from './shared'

export default function WorkspaceBar() {
  const ws = useWorkspace()
  const { search, pathname } = useLocation()
  const workspace = ws.workspace
  const contrast = pathname.endsWith('/contrast')
  const contextRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      const context = contextRef.current
      if (
        context?.open &&
        event.target instanceof Node &&
        !context.contains(event.target)
      )
        context.open = false
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [])
  return (
    <header className="workspace-brief">
      <div className="workspace-brief-main">
        <div>
          <h1>{contrast ? 'Compare methods' : 'Findings'}</h1>
        </div>
        <div className="workspace-brief-tools">
          <nav aria-label="Workspace views" className="view-switch">
            {[
              { path: '/findings', label: 'Findings' },
              { path: '/findings/contrast', label: 'Contrast' },
            ].map((item) => (
              <NavLink key={item.path} to={{ pathname: item.path, search }} end>
                {item.label}
              </NavLink>
            ))}
          </nav>
          {workspace ? (
            <details
              ref={contextRef}
              className="workspace-context"
              key={workspace.id}
              onBlur={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  event.currentTarget.open = false
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.currentTarget.open = false
                  event.currentTarget.querySelector('summary')?.focus()
                }
              }}
            >
              <summary>
                <span>{plural(workspace.cases.length, 'case file')}</span>
                <span className="workspace-version">v{workspace.version}</span>
                <Direction kind="down" />
              </summary>
              <div className="workspace-context-body">
                <p className="field-label">
                  Workspace details · Version {workspace.version}
                </p>
                <h2>{workspace.name}</h2>
                <p>{workspace.purpose}</p>
                <ul aria-label="Case files compared">
                  {workspace.cases.map((item) => (
                    <li key={item.id}>
                      <span>{item.code}</span>
                      <div>
                        <strong>{shortCaseName(item.name, item.code)}</strong>
                        {item.agency && <small>{item.agency}</small>}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="workspace-context-counts">
                  {plural(workspace.counts.originals, 'original')} ·{' '}
                  {plural(workspace.counts.statements, 'statement')} ·{' '}
                  {plural(workspace.counts.people, 'person', 'people')} ·{' '}
                  {plural(
                    workspace.counts.identity_candidates,
                    'identity candidate',
                  )}{' '}
                  · {plural(workspace.counts.conflicts, 'attribution conflict')}{' '}
                  · {plural(workspace.counts.findings, 'finding')}
                </p>
                <DemoControl hasWorkspace />
              </div>
            </details>
          ) : (
            <DemoControl hasWorkspace={false} />
          )}
        </div>
      </div>
      <DemoStatus />
      {ws.workspaceError && (
        <div className="mt-3">
          <ErrorNote message={ws.workspaceError} />
        </div>
      )}
    </header>
  )
}

/** Load or reset Operation Broken Mirror. A reset throws away every recorded
 *  decision, so it asks once more before doing it. */
function DemoControl({ hasWorkspace }: { hasWorkspace: boolean }) {
  const { demo, loadDemo } = useWorkspace()
  const [confirming, setConfirming] = useState(false)

  if (demo.busy) {
    return (
      <Button disabled aria-busy="true">
        Loading demo…
      </Button>
    )
  }
  if (!hasWorkspace) {
    return (
      <Button variant="primary" onClick={() => void loadDemo()}>
        Load demo
      </Button>
    )
  }
  if (confirming) {
    return (
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="Confirm demo reset"
      >
        <Button
          variant="danger"
          onClick={() => {
            setConfirming(false)
            void loadDemo()
          }}
        >
          Reset — discards every decision
        </Button>
        <Button
          variant="link"
          onClick={(event) => {
            setConfirming(false)
            event.currentTarget
              .closest('details')
              ?.querySelector('summary')
              ?.focus()
          }}
        >
          Cancel
        </Button>
      </div>
    )
  }
  return <Button onClick={() => setConfirming(true)}>Reset demo</Button>
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
    const elapsed = demo.startedAt
      ? Math.max(0, (now - demo.startedAt) / 1000)
      : 0
    return (
      <div role="status" className="border-t border-border px-4 py-2 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-body">
            Loading Operation Broken Mirror: preserving the originals,
            extracting statements, computing findings
          </span>
          <span className="numeric text-xs text-muted">
            {elapsed.toFixed(1)} s
          </span>
        </div>
        <div className="mt-1.5 h-[3px] overflow-hidden bg-subtle">
          <div className="indeterminate h-full w-2/5 bg-primary" />
        </div>
      </div>
    )
  }
  if (demo.error) {
    return (
      <div className="flex items-start gap-3 border-t border-border px-4 py-2 sm:px-5">
        <div className="min-w-0 flex-1">
          <ErrorNote message={`The demo did not load: ${demo.error}`} />
        </div>
        <Button variant="link" onClick={dismissDemoNotice}>
          Dismiss
        </Button>
      </div>
    )
  }
  if (demo.notice) {
    return (
      <div
        className={`flex items-center justify-between gap-3 border-t ${BORDER} bg-status-lead/10 px-4 py-2 sm:px-5`}
      >
        <p role="status" className="text-sm text-body">
          {demo.notice}
        </p>
        <Button variant="link" onClick={dismissDemoNotice}>
          Dismiss
        </Button>
      </div>
    )
  }
  return null
}
