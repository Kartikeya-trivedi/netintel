import { NavLink, Outlet } from 'react-router-dom'

import { useCase } from '../lib/CaseContext'
import { Legend } from './Instrument'

const NAV = [
  { to: '/graph', label: 'Network', index: '01' },
  { to: '/documents', label: 'Sources', index: '02' },
  { to: '/dashboard', label: 'Overview', index: '03' },
  { to: '/alerts', label: 'Signals', index: '04' },
]

export default function Layout() {
  const { cases, activeCase, setActiveCaseId } = useCase()

  return (
    <div className="grain relative flex h-full flex-col overflow-hidden bg-ink-1000">
      <header className="relative z-20 flex shrink-0 items-stretch border-b hairline bg-ink-1000">
        {/* Wordmark sits in its own ruled cell, like a plate on an instrument. */}
        <div className="flex items-center gap-3 border-r hairline px-5 py-3">
          <span className="h-6 w-[3px] bg-signal" />
          <div className="leading-none">
            <div className="font-semibold tracking-tight text-ink-100">NetIntel</div>
            <Legend className="mt-1 block">Network Intelligence</Legend>
          </div>
        </div>

        <nav className="flex items-stretch">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex items-center gap-2 border-r hairline px-4 transition-colors ${
                  isActive ? 'bg-ink-900 text-ink-100' : 'text-ink-500 hover:bg-ink-950'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="readout text-[10px] text-ink-700">{item.index}</span>
                  <span className="font-cond text-xs font-semibold uppercase tracking-[0.12em]">
                    {item.label}
                  </span>
                  {isActive && <span className="absolute inset-x-0 bottom-0 h-px bg-signal" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 px-5">
          <Legend>Case</Legend>
          {cases.length > 1 ? (
            <select
              value={activeCase?.id ?? ''}
              onChange={(event) => setActiveCaseId(Number(event.target.value))}
              className="border hairline bg-ink-950 px-2 py-1 font-mono text-xs text-ink-200"
            >
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-mono text-xs text-ink-200">
              {activeCase?.name ?? 'No case loaded'}
            </span>
          )}
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1">
        <Outlet />
      </main>

      <footer className="z-20 flex shrink-0 items-center justify-between border-t hairline px-5 py-1.5">
        <Legend>Authorized law-enforcement use — demo data is synthetic</Legend>
        <Legend className="readout">v0.1.0</Legend>
      </footer>
    </div>
  )
}
