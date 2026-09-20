import { useLocation } from 'react-router-dom'
import { useCase } from '../lib/CaseContext'
import { useWorkspace } from '../lib/WorkspaceContext'
import { setThemePref, useThemePref, type ThemePref } from '../lib/theme'
import { NAVIGATION } from './NavigationRail'
import Popover from '../ui/Popover'
import { Search } from '../ui/Symbols'

export default function ContextBar({
  onMenu,
  onSearch,
}: {
  onMenu: () => void
  onSearch: () => void
}) {
  const { cases, activeCase, setActiveCaseId } = useCase()
  const ws = useWorkspace()
  const { pathname } = useLocation()
  const theme = useThemePref()
  const crossCase =
    pathname === '/findings' || pathname.startsWith('/findings/')
  const section =
    NAVIGATION.find((item) => pathname.startsWith(item.to))?.label ??
    'Entity dossier'
  return (
    <header className="context-bar">
      <div className="context-left">
        <button
          type="button"
          className="workspace-menu"
          onClick={onMenu}
          aria-label="Open navigation"
        >
          <span aria-hidden="true" />
          <span className="sr-only">Menu</span>
        </button>
        <div className="context-picker">
          <span className="context-caption">
            {crossCase ? 'Workspace' : 'Case'}
          </span>
          {crossCase ? (
            <select
              aria-label="Workspace"
              value={ws.workspaceId ?? ''}
              onChange={(event) =>
                ws.selectWorkspace(Number(event.target.value))
              }
              disabled={!ws.workspaces?.length}
            >
              {ws.workspaces?.length ? (
                ws.workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))
              ) : (
                <option value="">Investigation workspace</option>
              )}
            </select>
          ) : (
            <select
              aria-label="Active case"
              value={activeCase?.id ?? ''}
              onChange={(event) => setActiveCaseId(Number(event.target.value))}
              disabled={!cases.length}
            >
              {cases.length ? (
                cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))
              ) : (
                <option value="">No case loaded</option>
              )}
            </select>
          )}
        </div>
        <span className="context-location">{section}</span>
      </div>
      <div className="context-right">
        <button
          type="button"
          className="quick-switch-trigger"
          onClick={onSearch}
          aria-label="Search views"
        >
          <Search size={15} />
          <span>Go to…</span>
          <kbd>{navigator.userAgent.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd>
        </button>
        <Popover className="workspace-preferences" label="Settings">
          <p className="preferences-title">Workspace preferences</p>
          <label className="appearance-picker">
            <span className="appearance-disc" aria-hidden="true" />
            <span className="sr-only">Colour theme</span>
            <select
              value={theme}
              onChange={(event) =>
                setThemePref(event.target.value as ThemePref)
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          {crossCase && (
            <div className="context-identity">
              <label htmlFor="demo-identity">
                Demo identity: not authentication.
              </label>
              <select
                id="demo-identity"
                value={ws.principal}
                onChange={(event) => ws.switchPrincipal(event.target.value)}
              >
                {ws.principals.map((person) => (
                  <option key={person.handle} value={person.handle}>
                    {person.name} · {person.role}
                  </option>
                ))}
                {!ws.principals.some(
                  (person) => person.handle === ws.principal,
                ) && <option value={ws.principal}>{ws.principal}</option>}
              </select>
            </div>
          )}
        </Popover>
      </div>
    </header>
  )
}
