import { NavLink, Outlet } from 'react-router-dom'

import { useCase } from '../lib/CaseContext'
import { toggleTheme, useResolvedTheme } from '../lib/theme'
import { Legend } from './Instrument'

const NAV = [
  { to: '/graph', label: 'Network', index: '01' },
  { to: '/documents', label: 'Sources', index: '02' },
  { to: '/dashboard', label: 'Overview', index: '03' },
  { to: '/alerts', label: 'Signals', index: '04' },
]

export default function Layout() {
  const { cases, activeCase, setActiveCaseId } = useCase()
  const theme = useResolvedTheme()

  return (
    <div className="grain relative flex h-full flex-col overflow-hidden bg-ink-1000">
      <header className="relative z-20 flex h-12 shrink-0 items-stretch border-b hairline bg-ink-1000">
        {/* Wordmark sits in its own ruled cell, like a plate on an instrument.
            The subtitle is the first thing to go when the frame narrows. */}
        <div className="flex shrink-0 items-center gap-2.5 border-r hairline px-3 sm:px-4">
          <span className="h-5 w-[3px] shrink-0 bg-signal" />
          <div className="leading-none">
            <div className="text-[13px] font-semibold tracking-tight text-ink-100">NetIntel</div>
            <Legend className="mt-1 hidden lg:block">Network Intelligence</Legend>
          </div>
        </div>

        <nav className="flex min-w-0 items-stretch">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex shrink-0 items-center gap-2 border-r hairline px-2.5 transition-colors sm:px-3.5 ${
                  isActive ? 'bg-ink-900 text-ink-100' : 'text-ink-500 hover:bg-ink-950 hover:text-ink-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="readout hidden text-[10px] text-ink-700 sm:inline">
                    {item.index}
                  </span>
                  <span className="font-cond text-[11px] font-semibold uppercase tracking-[0.12em]">
                    {item.label}
                  </span>
                  {isActive && (
                    <>
                      <span className="absolute inset-x-0 top-0 h-px bg-signal" />
                      <span className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-signal/12 to-transparent" />
                    </>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* The case cell absorbs whatever width is left and truncates rather
            than pushing itself off the edge of the frame. */}
        <div className="ml-auto flex min-w-0 items-center gap-2.5 border-l hairline px-3 sm:px-4">
          <Legend className="hidden shrink-0 sm:inline">Case</Legend>
          {cases.length > 1 ? (
            <select
              value={activeCase?.id ?? ''}
              onChange={(event) => setActiveCaseId(Number(event.target.value))}
              className="min-w-0 border hairline bg-ink-950 px-2 py-1 font-mono text-xs text-ink-200"
            >
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate font-mono text-xs text-ink-200">
              {activeCase?.name ?? 'No case loaded'}
            </span>
          )}
        </div>

        {/* Reading a case file on paper or in a darkroom. Pins the choice on
            click; until then the OS preference decides. */}
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to paper' : 'Switch to darkroom'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="flex shrink-0 items-center border-l hairline px-3 text-ink-500 transition-colors hover:bg-ink-950 hover:text-signal"
        >
          {theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M20.5 14.6A8.6 8.6 0 1 1 9.4 3.5a6.9 6.9 0 0 0 11.1 11.1Z" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </header>

      {/* Long pages scroll here; full-bleed workspaces (graph, sources) size
          themselves to this box with h-full and scroll internally. */}
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <footer className="z-20 flex shrink-0 items-center justify-between gap-4 border-t hairline px-4 py-1.5">
        <Legend className="truncate">
          Authorized law-enforcement use — demo data is synthetic
        </Legend>
        <Legend className="readout shrink-0">v0.1.0</Legend>
      </footer>
    </div>
  )
}
