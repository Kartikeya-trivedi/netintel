/** Thin typed fetch wrapper over the NetIntel API.
 *
 * Vite proxies /api to the FastAPI server in dev (see vite.config.ts), so the
 * default base URL stays relative and there is no CORS handling in the browser.
 */

import type {
  Alert, Case, CaseStats, Community, Doc, DocDetail, Entity, EntityProfile,
  GraphPayload, KeyPlayer, MetricName, PathResult, VulnerabilityReport,
} from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new ApiError(response.status, detail || response.statusText)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  // Cases
  listCases: () => request<Case[]>('/api/cases'),
  getCase: (id: number) => request<Case>(`/api/cases/${id}`),
  createCase: (name: string, description?: string) =>
    request<Case>('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    }),
  caseStats: (id: number) => request<CaseStats>(`/api/cases/${id}/stats`),

  // Documents
  listDocuments: (caseId: number) => request<Doc[]>(`/api/cases/${caseId}/documents`),
  getDocument: (caseId: number, docId: number) =>
    request<DocDetail>(`/api/cases/${caseId}/documents/${docId}`),
  uploadDocument: (caseId: number, file: File, docType: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', docType)
    return request<Doc>(`/api/cases/${caseId}/documents`, { method: 'POST', body: form })
  },

  // Entities
  listEntities: (caseId: number, entityType?: string) =>
    request<Entity[]>(
      `/api/cases/${caseId}/entities${entityType ? `?entity_type=${entityType}` : ''}`,
    ),
  getEntity: (caseId: number, entityId: number) =>
    request<EntityProfile>(`/api/cases/${caseId}/entities/${entityId}`),

  // Graph
  getGraph: (caseId: number, params?: { entityTypes?: string[]; relTypes?: string[] }) => {
    const query = new URLSearchParams()
    if (params?.entityTypes?.length) query.set('entity_types', params.entityTypes.join(','))
    if (params?.relTypes?.length) query.set('rel_types', params.relTypes.join(','))
    const suffix = query.toString() ? `?${query}` : ''
    return request<GraphPayload>(`/api/cases/${caseId}/graph${suffix}`)
  },
  getKeyPlayers: (caseId: number, metric: MetricName = 'betweenness', top = 10) =>
    request<KeyPlayer[]>(`/api/cases/${caseId}/graph/metrics?metric=${metric}&top=${top}`),
  getCommunities: (caseId: number) =>
    request<Community[]>(`/api/cases/${caseId}/graph/communities`),
  findPath: (caseId: number, source: number, target: number) =>
    request<PathResult>(`/api/cases/${caseId}/graph/path?source=${source}&target=${target}`),
  getVulnerabilities: (caseId: number, top = 5) =>
    request<VulnerabilityReport>(`/api/cases/${caseId}/graph/vulnerabilities?top=${top}`),

  // Alerts
  listAlerts: (caseId: number) => request<Alert[]>(`/api/cases/${caseId}/alerts`),
  updateAlertStatus: (caseId: number, alertId: number, status: 'open' | 'reviewed') =>
    request<Alert>(`/api/cases/${caseId}/alerts/${alertId}?status=${status}`, { method: 'PATCH' }),

  // Demo
  resetDemo: () => request<Case>('/api/demo/reset', { method: 'POST' }),
}

export { ApiError }
