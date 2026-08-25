import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import Alerts from './pages/Alerts'
import Dashboard from './pages/Dashboard'
import Documents from './pages/Documents'
import EntityProfile from './pages/EntityProfile'
import GraphExplorer from './pages/GraphExplorer'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/graph" element={<GraphExplorer />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/entities/:entityId" element={<EntityProfile />} />
      </Route>
    </Routes>
  )
}
