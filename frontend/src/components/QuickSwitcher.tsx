import { useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Dialog } from '../ui'
import { Search, ArrowRight } from '../ui/Symbols'

const DESTINATIONS = [
  {
    path: '/findings',
    label: 'Findings',
    description: 'Cross-case connections and original evidence',
    terms: 'evidence connections review',
  },
  {
    path: '/findings/contrast',
    label: 'Compare methods',
    description: 'Compare the two readings of your case files',
    terms: 'contrast assumptions',
  },
  {
    path: '/dashboard',
    label: 'Overview',
    description: 'The active case at a glance',
    terms: 'dashboard stats summary',
  },
  {
    path: '/graph',
    label: 'Network',
    description: 'People, connections and their sources',
    terms: 'graph trace simulate',
  },
  {
    path: '/documents',
    label: 'Sources',
    description: 'Read or add original documents',
    terms: 'documents reports upload files',
  },
  {
    path: '/alerts',
    label: 'Signals',
    description: 'Unusual transfers and communication patterns',
    terms: 'alerts calls transactions',
  },
]

export default function QuickSwitcher({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      title="Go to a view"
      initialFocus=".switcher-search input"
      onClose={onClose}
    >
      {open && <SwitcherResults onClose={onClose} />}
    </Dialog>
  )
}

function SwitcherResults({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const results = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const term = query.trim().toLowerCase()
  const visible = DESTINATIONS.filter((item) =>
    `${item.label} ${item.description} ${item.terms}`
      .toLowerCase()
      .includes(term),
  ).sort(
    (a, b) =>
      Number(b.label.toLowerCase().startsWith(term)) -
      Number(a.label.toLowerCase().startsWith(term)),
  )
  function go(path: string) {
    const nextSearch =
      path.startsWith('/findings') && pathname.startsWith('/findings')
        ? search
        : ''
    navigate({ pathname: path, search: nextSearch })
    onClose()
    requestAnimationFrame(() =>
      document.getElementById('main-content')?.focus({ preventScroll: true }),
    )
  }
  function walk(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [
      ...(results.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ]
    if (!items.length) return
    event.preventDefault()
    const at = items.findIndex((item) => item === document.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (at + (event.key === 'ArrowUp' ? -1 : 1) + items.length) %
            items.length
    items[next].focus()
  }
  return (
    <div className="quick-switcher">
      <label className="switcher-search">
        <Search size={18} />
        <span className="sr-only">Find a view</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Where do you want to go?"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              results.current?.querySelector('button')?.focus()
            }
            if (event.key === 'Enter' && visible[0]) {
              event.preventDefault()
              go(visible[0].path)
            }
          }}
        />
      </label>
      <div ref={results} onKeyDown={walk} className="switcher-results">
        <p className="switcher-caption" aria-live="polite">
          {query ? `${visible.length} matching views` : 'Workspace views'}
        </p>
        {visible.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => go(item.path)}
            aria-current={pathname === item.path ? 'page' : undefined}
          >
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            <ArrowRight size={17} />
          </button>
        ))}
        {visible.length === 0 && (
          <p className="switcher-empty">
            No matching view. Try “sources”, “network” or “review”.
          </p>
        )}
      </div>
      <p className="switcher-help">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> browse
        </span>
        <span>
          <kbd>Enter</kbd> open
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </p>
    </div>
  )
}
