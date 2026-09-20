import { NavLink } from 'react-router-dom'
import { BrandLockup } from '../ui/Identity'

export const NAVIGATION = [
  { to: '/findings', label: 'Findings', group: 'Investigation' },
  { to: '/dashboard', label: 'Overview', group: 'Case files' },
  { to: '/graph', label: 'Network', group: 'Case files' },
  { to: '/documents', label: 'Sources', group: 'Case files' },
  { to: '/vision', label: 'Camera', group: 'Case files' },
  { to: '/alerts', label: 'Signals', group: 'Case files' },
]

export function WorkspaceNavigation({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  return (
    <nav className="workspace-navigation" aria-label="Main navigation">
      {['Investigation', 'Case files'].map((group) => (
        <div key={group} className="navigation-group">
          <p>{group}</p>
          {NAVIGATION.filter((item) => item.group === group).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) => (isActive ? 'is-active' : undefined)}
            >
              <span>{item.label}</span>
              <span className="navigation-current" aria-hidden="true" />
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

export default function NavigationRail() {
  return (
    <aside className="workspace-rail" aria-label="Application sidebar">
      <NavLink to="/" className="workspace-brand" aria-label="NetIntel home">
        <BrandLockup />
      </NavLink>
      <WorkspaceNavigation />
      <div className="rail-end">
        <span className="rail-product-note">Evidence. In context.</span>
        <span>NetIntel · SIH26189</span>
      </div>
    </aside>
  )
}
