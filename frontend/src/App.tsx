import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import Layout from './components/Layout'
import { WorkspaceProvider } from './lib/WorkspaceContext'
import { CaseProvider } from './lib/CaseContext'
const Landing = lazy(() => import('./pages/Landing'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Documents = lazy(() => import('./pages/Documents'))
const EntityProfile = lazy(() => import('./pages/EntityProfile'))
const Findings = lazy(() => import('./pages/Findings'))
const GraphExplorer = lazy(() => import('./pages/GraphExplorer'))
const Vision = lazy(() => import('./pages/Vision'))

/** The public page needs no case data. The app entry still opens Findings,
 *  or the bundled graph when running the read-only static preview. */
const HOME = import.meta.env.MODE === 'static' ? '/graph' : '/findings'

export default function App() {
  const { pathname } = useLocation()
  return (
    <CaseProvider enabled={pathname !== '/'}>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense
              fallback={
                <div
                  role="status"
                  style={{
                    minHeight: '100dvh',
                    background: '#0b0c0e',
                    color: '#b6b9c2',
                    padding: 32,
                  }}
                >
                  Loading NetIntel…
                </div>
              }
            >
              <Landing />
            </Suspense>
          }
        />
        <Route path="/app" element={<Navigate to={HOME} replace />} />
        <Route
          element={
            <WorkspaceProvider>
              <Layout />
            </WorkspaceProvider>
          }
        >
          <Route path="/findings" element={<Findings />} />
          <Route
            path="/findings/contrast"
            element={<Findings view="contrast" />}
          />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/graph" element={<GraphExplorer />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/vision" element={<Vision />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/entities/:entityId" element={<EntityProfile />} />
        </Route>
      </Routes>
    </CaseProvider>
  )
}
