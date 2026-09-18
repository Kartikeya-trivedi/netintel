import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'

import {
  getPrincipal,
  inv,
  setPrincipal,
  type Me,
  type PrincipalInfo,
  type Workspace,
  type WorkspaceListItem,
} from '../api/investigation'
import { useCase } from './CaseContext'
import { errorMessage } from './format'
import { useScopedAsync } from './useApi'

/** Who is asking, and which cross-case workspace they are looking at.
 *
 *  The identity is a demo stand-in for authentication (the X-Principal header)
 *  and every view labels it that way. Switching it changes what the server is
 *  willing to show, so every workspace request is scoped to the identity and
 *  nothing fetched for one identity is ever shown to another.
 */

const WORKSPACE_KEY = 'netintel.workspace'

function readRememberedWorkspace(): number | null {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY)
    const id = raw === null ? NaN : Number(raw)
    return Number.isInteger(id) ? id : null
  } catch {
    return null
  }
}

function rememberWorkspace(id: number) {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, String(id))
  } catch {
    // Blocked storage: the choice lasts until reload.
  }
}

export interface DemoState {
  busy: boolean
  startedAt: number | null
  error: string | null
  notice: string | null
}

interface WorkspaceContextValue {
  principal: string
  principals: PrincipalInfo[]
  switchPrincipal: (handle: string) => void
  me: Me | null
  workspaces: WorkspaceListItem[] | null
  workspacesLoading: boolean
  workspacesError: string | null
  /** HTTP status of a failed workspace-list read; 401 means the server does
   *  not know this identity, which on a fresh database means no demo yet. */
  workspacesStatus: number | null
  workspaceId: number | null
  selectWorkspace: (id: number) => void
  workspace: Workspace | null
  workspaceLoading: boolean
  workspaceError: string | null
  /** "principal|workspace". Views scope their own requests under it. */
  scope: string
  /** Bumped by refresh(). Views put it in their deps so a decision or a demo
   *  reset refetches everything that could have changed. */
  revision: number
  refresh: () => void
  demo: DemoState
  loadDemo: () => Promise<void>
  dismissDemoNotice: () => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { reload: reloadCases } = useCase()

  // Nothing is requested until the findings views are first opened, so the
  // older case pages do not start talking to the investigation layer.
  const onFindings = pathname === '/findings' || pathname.startsWith('/findings/')
  const [active, setActive] = useState(onFindings)
  useEffect(() => {
    if (onFindings) setActive(true)
  }, [onFindings])

  const [principal, setPrincipalState] = useState(getPrincipal)
  const [chosenId, setChosenId] = useState<number | null>(readRememberedWorkspace)
  const [revision, setRevision] = useState(0)
  const [demo, setDemo] = useState<DemoState>({ busy: false, startedAt: null, error: null, notice: null })

  const principals = useScopedAsync(() => inv.principals(), 'principals', [revision], { enabled: active })
  const me = useScopedAsync(() => inv.me(), principal, [revision], { enabled: active })
  const workspaces = useScopedAsync(() => inv.workspaces(), principal, [revision], { enabled: active })

  const workspaceId = useMemo(() => {
    const list = workspaces.data
    if (!list || list.length === 0) return null
    return (list.find((item) => item.id === chosenId) ?? list[0]).id
  }, [workspaces.data, chosenId])

  const scope = `${principal}|${workspaceId ?? 'none'}`
  const workspace = useScopedAsync(() => inv.workspace(workspaceId!), scope, [revision], {
    enabled: active && workspaceId !== null,
  })

  const refresh = useCallback(() => setRevision((current) => current + 1), [])

  const switchPrincipal = useCallback((handle: string) => {
    setPrincipal(handle)
    setPrincipalState(handle)
  }, [])

  const selectWorkspace = useCallback((id: number) => {
    rememberWorkspace(id)
    setChosenId(id)
  }, [])

  const loadDemo = useCallback(async () => {
    setDemo({ busy: true, startedAt: Date.now(), error: null, notice: null })
    try {
      const result = await inv.resetBrokenMirror()
      let notice: string | null = null
      if (result.principal !== principal) {
        // The demo grants belong to its investigator; another identity would
        // load the files and then be refused the workspace it just made.
        notice = `Demo identity switched from ${principal} to ${result.principal}, who holds the grants for this workspace.`
        setPrincipal(result.principal)
        setPrincipalState(result.principal)
      }
      rememberWorkspace(result.workspace_id)
      setChosenId(result.workspace_id)
      setDemo({ busy: false, startedAt: null, error: null, notice })
      // The loader also re-ingests the older case pipeline, so the network and
      // sources pages need their case list re-read too.
      reloadCases()
      refresh()
    } catch (error) {
      setDemo({ busy: false, startedAt: null, error: errorMessage(error), notice: null })
    }
  }, [principal, refresh, reloadCases])

  const dismissDemoNotice = useCallback(() => setDemo((current) => ({ ...current, notice: null, error: null })), [])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      principal,
      principals: principals.data ?? [],
      switchPrincipal,
      me: me.data,
      workspaces: workspaces.data,
      workspacesLoading: workspaces.loading,
      workspacesError: workspaces.error,
      workspacesStatus: workspaces.status,
      workspaceId,
      selectWorkspace,
      workspace: workspace.data,
      workspaceLoading: workspace.loading,
      workspaceError: workspace.error,
      scope,
      revision,
      refresh,
      demo,
      loadDemo,
      dismissDemoNotice,
    }),
    [
      principal,
      principals.data,
      switchPrincipal,
      me.data,
      workspaces.data,
      workspaces.loading,
      workspaces.error,
      workspaces.status,
      workspaceId,
      selectWorkspace,
      workspace.data,
      workspace.loading,
      workspace.error,
      scope,
      revision,
      refresh,
      demo,
      loadDemo,
      dismissDemoNotice,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (context === null) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider')
  }
  return context
}
