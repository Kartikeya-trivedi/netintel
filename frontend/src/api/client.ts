/** Thin typed fetch wrapper over the NetIntel API.
 *
 * Vite proxies /api to the FastAPI server in dev (see vite.config.ts), so the
 * default base URL stays relative and there is no CORS handling in the browser.
 */

import type {
  Alert, Case, CaseStats, Community, Doc, DocDetail, Entity, EntityProfile,
  GraphPayload, KeyPlayer, MetricName, PathResult, VulnerabilityReport,
  VisionRun, VisionRunDetail,
} from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

/** `npm run build:static` builds the hosted preview, which runs without a backend.
 *  Every read is answered from public/static-api.json, a copy of the demo case
 *  exported from the real API (backend: `python -m app.seed.export_static_api`),
 *  and anything that would write is refused. */
const STATIC = import.meta.env.MODE === 'static'

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

let staticResponses: Promise<Record<string, unknown>> | null = null

function loadStaticResponses(): Promise<Record<string, unknown>> {
  staticResponses ??= fetch(`${import.meta.env.BASE_URL}static-api.json`)
    .then((response) => {
      if (!response.ok) throw new ApiError(response.status, 'Preview data is unavailable')
      return response.json() as Promise<Record<string, unknown>>
    })
    .catch((error: unknown) => {
      // Let the next view retry rather than serving a cached failure forever.
      staticResponses = null
      throw error
    })
  return staticResponses
}

/** Mirrors request_key() in backend/app/seed/export_static_api.py. */
function staticKey(path: string): string {
  const url = new URL(path, 'http://preview.invalid')
  const query = [...url.searchParams]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
  return query ? `${url.pathname}?${query}` : url.pathname
}

async function staticRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'
  const isReset = method === 'POST' && path === '/api/demo/reset'
  if (method !== 'GET' && !isReset) {
    throw new ApiError(405, 'Read-only preview: ingesting documents needs the live backend.')
  }

  const responses = await loadStaticResponses()
  if (isReset) {
    // The preview always holds the freshly seeded demo, so there is nothing to redo.
    return (responses['/api/cases'] as unknown[])[0] as T
  }

  const key = staticKey(path)
  if (!(key in responses)) throw new ApiError(404, `No preview data for ${key}`)
  return responses[key] as T
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (STATIC) return staticRequest<T>(path, init)

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

  // Vision — CCTV stills and uploaded video
  listVisionRuns: (caseId: number) => request<VisionRun[]>(`/api/cases/${caseId}/vision`),
  getVisionRun: (caseId: number, runId: number) =>
    request<VisionRunDetail>(`/api/cases/${caseId}/vision/${runId}`),
  analyseVideo: (caseId: number, file: File, maxFrames?: number) => {
    const form = new FormData()
    form.append('file', file)
    if (maxFrames) form.append('max_frames', String(maxFrames))
    return request<VisionRun>(`/api/cases/${caseId}/vision/video`, { method: 'POST', body: form })
  },
  analyseCamera: (caseId: number, url: string, frames = 4) =>
    request<VisionRun>(`/api/cases/${caseId}/vision/camera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, frames }),
    }),
  deleteVisionRun: (caseId: number, runId: number) =>
    request<void>(`/api/cases/${caseId}/vision/${runId}`, { method: 'DELETE' }),
  /** Annotated frame JPEG. Used as an <img> src, so it returns a URL not a promise. */
  visionFrameUrl: (caseId: number, runId: number, frameIndex: number) =>
    `${BASE}/api/cases/${caseId}/vision/${runId}/frames/${frameIndex}`,

  // Demo
  resetDemo: () => request<Case>('/api/demo/reset', { method: 'POST' }),
}

export { ApiError }
