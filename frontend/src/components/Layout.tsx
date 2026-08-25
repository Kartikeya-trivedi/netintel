import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/graph', label: 'Graph Explorer' },
  { to: '/documents', label: 'Documents' },
  { to: '/alerts', label: 'Alerts' },
]

export default function Layout() {
  return (
    <div className="flex h-full flex-col bg-console-950">
      <header className="flex items-center gap-6 border-b border-console-800 px-6 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-console-200">NetIntel</span>
          <span className="text-xs text-console-400">Criminal Network Intelligence</span>
        </div>
        <nav className="flex gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-console-800 text-console-200'
                    : 'text-console-400 hover:bg-console-900 hover:text-console-200'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>

      <footer className="border-t border-console-800 px-6 py-2 text-xs text-console-400">
        For authorized law-enforcement use. All data shown in this demo is synthetic.
      </footer>
    </div>
  )
}
