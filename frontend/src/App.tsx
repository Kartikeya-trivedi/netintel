import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import { WorkspaceProvider } from './lib/WorkspaceContext'
import Alerts from './pages/Alerts'
import Dashboard from './pages/Dashboard'
import Documents from './pages/Documents'
import EntityProfile from './pages/EntityProfile'
import Findings from './pages/Findings'
import GraphExplorer from './pages/GraphExplorer'

/** The findings workspace is the front door. The static preview build has no
 *  backend to compute findings with, so there the door stays on the network
 *  view, which the preview can serve from its bundled snapshot. */
const HOME = import.meta.env.MODE === 'static' ? '/graph' : '/findings'

export default function App() {
  return (
    <Routes>
      <Route
        element={
          <WorkspaceProvider>
            <Layout />
          </WorkspaceProvider>
        }
      >
        <Route path="/" element={<Navigate to={HOME} replace />} />
        <Route path="/findings" element={<Findings />} />
        <Route path="/findings/contrast" element={<Findings view="contrast" />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/graph" element={<GraphExplorer />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/entities/:entityId" element={<EntityProfile />} />
      </Route>
    </Routes>
  )
}
