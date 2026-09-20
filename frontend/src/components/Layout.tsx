import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Dialog, LoadingPane } from '../ui'
import ContextBar from './ContextBar'
import NavigationRail, { WorkspaceNavigation } from './NavigationRail'
import QuickSwitcher from './QuickSwitcher'

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const main = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  useEffect(() => {
    main.current?.scrollTo(0, 0)
  }, [pathname])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open]') && !switcherOpen) return
        event.preventDefault()
        setSwitcherOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [switcherOpen])
  return (
    <div className="workspace-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:p-3"
      >
        Skip to content
      </a>
      <NavigationRail />
      <div className="workspace-body">
        <ContextBar
          onMenu={() => setMenuOpen(true)}
          onSearch={() => setSwitcherOpen(true)}
        />
        <main
          ref={main}
          id="main-content"
          className="app-content"
          tabIndex={-1}
        >
          <Suspense fallback={<LoadingPane />}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="workspace-footer">
          <span className="footer-use-mark" aria-hidden="true" />
          <span>Authorised law-enforcement use. Demo data is synthetic.</span>
          <span className="workspace-footer-name">NetIntel</span>
        </footer>
      </div>
      <Dialog
        open={menuOpen}
        title="NetIntel"
        onClose={() => setMenuOpen(false)}
      >
        <WorkspaceNavigation onNavigate={() => setMenuOpen(false)} />
      </Dialog>
      <QuickSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </div>
  )
}
