import { useEffect, useRef, useState } from 'react'

import { Plus } from '../ui/Symbols'
import { api } from '../api/client'
import type { Tone } from '../ui'
import type { Severity, VisionClue, VisionRun } from '../api/types'
import {
  Button,
  Chip,
  Dialog,
  EmptyNote,
  ErrorNote,
  FieldLabel,
  LoadingState,
  LoadingPane,
} from '../ui'
import { useCase } from '../lib/CaseContext'
import { useScopedAsync } from '../lib/useApi'
import { Direction } from '../ui/Identity'

/** Detection runs in the background, so the list re-reads itself while any
 *  run is still working. Stops as soon as nothing is in flight. */
const POLL_MS = 1500

const SEVERITY_TONE: Record<Severity, Tone> = {
  high: 'signal',
  medium: 'lead',
  low: 'neutral',
}

const RELEVANCE_LABEL: Record<string, string> = {
  person: 'People',
  vehicle: 'Vehicles',
  carried: 'Carried items',
  device: 'Devices',
  weapon: 'Possible weapons',
  ambient: 'Background',
}

const STATUS_STYLES: Record<string, string> = {
  processed: 'text-ent-org',
  processing: 'text-primary',
  pending: 'text-muted',
  failed: 'text-sev-high',
}

function sourceLabel(run: VisionRun): string {
  return run.source_kind === 'cctv' ? 'Camera' : 'Video'
}

export default function Vision() {
  const { activeCase, version } = useCase()
  const caseId = activeCase?.id ?? null

  const [addOpen, setAddOpen] = useState(false)
  const [mode, setMode] = useState<'video' | 'cctv'>('video')
  const [cameraUrl, setCameraUrl] = useState('')
  const [grabs, setGrabs] = useState(4)
  const [selection, setSelection] = useState<{
    caseId: number
    id: number
  } | null>(null)
  const selectedId = selection?.caseId === caseId ? selection.id : null
  const setSelectedId = (id: number | null) =>
    setSelection(id !== null && caseId !== null ? { caseId, id } : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [activeFrame, setActiveFrame] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const runs = useScopedAsync(
    () => api.listVisionRuns(caseId!),
    `case:${caseId}`,
    [version],
    { enabled: caseId !== null },
  )
  const detail = useScopedAsync(
    () => api.getVisionRun(caseId!, selectedId!),
    `case:${caseId}:vision:${selectedId}`,
    [version],
    { enabled: caseId !== null && selectedId !== null },
  )

  const working = (runs.data ?? []).some(
    (run) => run.status === 'processing' || run.status === 'pending',
  )

  // Re-read while the detector is still working, then stop. An interval that
  // never clears would keep the case hot for as long as the tab is open.
  useEffect(() => {
    if (!working) return
    const timer = window.setInterval(() => {
      runs.reload()
      if (selectedId !== null) detail.reload()
    }, POLL_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, selectedId])

  useEffect(() => setActiveFrame(0), [selectedId])

  async function submitVideo(files: FileList | null) {
    if (!files?.length || caseId === null) return
    setActionError(null)
    try {
      for (const file of Array.from(files)) {
        setBusy(`Reading ${file.name}`)
        const run = await api.analyseVideo(caseId, file)
        setSelectedId(run.id)
      }
      setAddOpen(false)
      runs.reload()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function submitCamera() {
    if (caseId === null || !cameraUrl.trim()) return
    setActionError(null)
    setBusy('Opening camera')
    try {
      const run = await api.analyseCamera(caseId, cameraUrl.trim(), grabs)
      setSelectedId(run.id)
      setAddOpen(false)
      setCameraUrl('')
      runs.reload()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function removeRun(runId: number) {
    if (caseId === null) return
    setActionError(null)
    try {
      await api.deleteVisionRun(caseId, runId)
      if (selectedId === runId) setSelectedId(null)
      runs.reload()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const open = detail.data
  const frame = open?.frames?.[activeFrame] ?? null

  return (
    <div className="documents-layout" data-reading={selectedId !== null}>
      <aside
        className="min-w-0 border-r border-border bg-surface"
        aria-label="Camera analyses"
      >
        <div className="p-5">
          <h1 className="text-xl font-bold text-heading">Camera</h1>
          <p className="mt-1 text-xs text-muted">
            What the cameras saw, and what it might mean.
          </p>
          <Button
            className="mt-5 w-full"
            variant="primary"
            onClick={() => setAddOpen(true)}
            disabled={caseId === null}
          >
            <Plus size={16} />
            Add footage
          </Button>
        </div>
        <div className="flex items-center justify-between px-5 pb-2 text-xs text-muted">
          <span>All analyses</span>
          <span className="numeric">{runs.data?.length ?? 0}</span>
        </div>
        {runs.loading && (
          <div className="px-5">
            <LoadingState label="Reading analyses" />
          </div>
        )}
        {runs.error && (
          <div className="p-4">
            <ErrorNote message={runs.error} />
          </div>
        )}
        <ul className="max-h-[440px] overflow-y-auto px-3 pb-4 xl:max-h-none">
          {(runs.data ?? []).map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => setSelectedId(run.id)}
                aria-current={selectedId === run.id ? 'true' : undefined}
                className="source-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-xs font-semibold text-heading">
                    {run.source_ref}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                    <span>
                      {sourceLabel(run)} · {run.detection_count} detections
                    </span>
                    <span className={STATUS_STYLES[run.status] ?? 'text-muted'}>
                      {run.status}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {runs.data?.length === 0 && (
          <EmptyNote>
            No footage analysed yet. Add a clip or point NetIntel at a camera.
          </EmptyNote>
        )}
        {actionError && (
          <div className="border-t border-border p-4">
            <ErrorNote message={actionError} />
          </div>
        )}
      </aside>

      <section className="source-reader" aria-label="Analysis reader">
        <button
          type="button"
          className="source-back"
          onClick={() => setSelectedId(null)}
        >
          <Direction kind="left" />
          All analyses
        </button>

        {selectedId === null && (
          <div className="source-empty">
            <span className="source-empty-rule" aria-hidden="true" />
            <h2 className="text-2xl font-bold text-heading">Open an analysis</h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
              Every clue points back at the frame it came from, so you can see
              exactly what the detector saw.
            </p>
            {runs.data?.[0] && (
              <Button
                variant="quiet"
                className="mt-6"
                onClick={() => setSelectedId(runs.data![0].id)}
              >
                Open newest analysis
                <Direction />
              </Button>
            )}
          </div>
        )}

        {detail.loading && <LoadingPane label="Opening analysis" />}
        {detail.error && <ErrorNote message={detail.error} />}

        {open && (
          <article className="source-paper">
            <header className="border-b border-border pb-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip>{sourceLabel(open)}</Chip>
                <Chip tone={open.status === 'processed' ? 'supported' : 'neutral'}>
                  {open.status}
                </Chip>
                <Chip tone="muted">{open.engine}</Chip>
              </div>
              <h2 className="break-words text-xl font-bold text-heading">
                {open.source_ref}
              </h2>
              <p className="mt-3 text-xs text-muted">
                {open.frame_count} frames · {open.detection_count} detections
                {open.summary.duration_sec
                  ? ` · ${open.summary.duration_sec}s of footage`
                  : ''}
              </p>
              {open.engine === 'motion-fallback' && (
                <p className="mt-3 text-xs text-sev-medium">
                  YOLO was unavailable, so these boxes are moving shapes, not
                  recognised objects. Install ultralytics to identify them.
                </p>
              )}
              {open.error && (
                <div className="mt-3">
                  <ErrorNote message={open.error} />
                </div>
              )}
            </header>

            {open.status === 'processing' && (
              <div className="mt-6">
                <LoadingState label="Detector is reading the frames" />
              </div>
            )}

            {open.status === 'processed' && open.clues.length > 0 && (
              <section className="mt-6">
                <h3 className="text-sm font-bold text-heading">Clues</h3>
                <ul className="mt-3 space-y-2">
                  {open.clues.map((clue: VisionClue, position: number) => (
                    <li
                      key={`${clue.kind}-${position}`}
                      className="rounded-lg border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={SEVERITY_TONE[clue.severity] ?? 'neutral'}>
                          {clue.severity}
                        </Chip>
                        <strong className="text-sm text-heading">
                          {clue.title}
                        </strong>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        {clue.detail}
                      </p>
                      {clue.frames.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted">Seen in</span>
                          {clue.frames.map((index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => setActiveFrame(index)}
                              className="rounded-md border border-line px-2 py-0.5 text-xs text-heading hover:bg-subtle"
                            >
                              frame {index + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {frame && (
              <section className="mt-6">
                <h3 className="text-sm font-bold text-heading">
                  Frame {frame.frame_index + 1} of {open.frames.length}
                  <span className="ml-2 font-normal text-muted">
                    at {frame.timestamp_sec}s
                  </span>
                </h3>
                <img
                  src={api.visionFrameUrl(open.case_id, open.id, frame.frame_index)}
                  alt={`Frame ${frame.frame_index + 1} with ${frame.detections.length} detections marked`}
                  className="mt-3 w-full rounded-xl border border-border"
                />
                <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                  {open.frames.map((thumb) => (
                    <button
                      key={thumb.id}
                      type="button"
                      onClick={() => setActiveFrame(thumb.frame_index)}
                      aria-current={
                        thumb.frame_index === activeFrame ? 'true' : undefined
                      }
                      className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs ${
                        thumb.frame_index === activeFrame
                          ? 'border-primary bg-primary-soft text-heading'
                          : 'border-line text-muted hover:bg-subtle'
                      }`}
                    >
                      {thumb.frame_index + 1}
                      <span className="numeric ml-1.5">
                        {thumb.detections.length}
                      </span>
                    </button>
                  ))}
                </div>
                <ul className="mt-2 space-y-1">
                  {frame.detections.map((found, position) => (
                    <li
                      key={`${found.label}-${position}`}
                      className="flex items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-subtle"
                    >
                      <span className="text-heading">
                        {found.label}
                        <span className="ml-2 text-muted">
                          {RELEVANCE_LABEL[found.relevance] ?? found.relevance}
                        </span>
                      </span>
                      <span className="numeric text-muted">
                        {Math.round(found.confidence * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
                {frame.detections.length === 0 && (
                  <EmptyNote>Nothing was detected in this frame.</EmptyNote>
                )}
              </section>
            )}

            <footer className="mt-8 border-t border-border pt-4">
              <Button onClick={() => void removeRun(open.id)}>
                Delete analysis
              </Button>
            </footer>
          </article>
        )}
      </section>

      <aside
        className="document-entities min-w-0 border-l border-border bg-surface p-4"
        aria-label="What was seen"
      >
        <h2 className="mb-4 text-sm font-bold text-heading">What was seen</h2>
        {open && Object.keys(open.summary.labels ?? {}).length > 0 ? (
          <ul className="space-y-1">
            {Object.entries(open.summary.labels ?? {}).map(([label, count]) => (
              <li
                key={label}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"
              >
                <span className="text-heading">{label}</span>
                <span className="numeric text-muted">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            Object counts for the open analysis will appear here.
          </p>
        )}
      </aside>

      <Dialog
        open={addOpen}
        title="Add footage to this case"
        onClose={() => setAddOpen(false)}
      >
        <div className="space-y-5">
          <div className="flex gap-2">
            <Button
              variant={mode === 'video' ? 'primary' : undefined}
              onClick={() => setMode('video')}
            >
              Upload video
            </Button>
            <Button
              variant={mode === 'cctv' ? 'primary' : undefined}
              onClick={() => setMode('cctv')}
            >
              Fetch from camera
            </Button>
          </div>

          {mode === 'video' ? (
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                void submitVideo(event.dataTransfer.files)
              }}
              className="flex flex-col items-center rounded-xl border-2 border-dashed border-line bg-primary-soft px-5 py-10 text-center"
            >
              <p className="mb-4 text-sm text-heading">Drop a clip here</p>
              <Button
                variant="primary"
                disabled={Boolean(busy)}
                onClick={() => fileInput.current?.click()}
              >
                Browse files
              </Button>
              <p className="mt-3 text-xs text-muted">MP4 · MOV · AVI · MKV</p>
              <input
                ref={fileInput}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => void submitVideo(event.target.files)}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <FieldLabel>Camera URL</FieldLabel>
                <input
                  type="url"
                  className="mt-2 block w-full"
                  placeholder="rtsp://192.168.1.40/stream"
                  value={cameraUrl}
                  onChange={(event) => setCameraUrl(event.target.value)}
                />
              </label>
              <label className="block">
                <FieldLabel>Stills to grab</FieldLabel>
                <input
                  type="number"
                  min={1}
                  max={40}
                  className="mt-2 block w-full"
                  value={grabs}
                  onChange={(event) => setGrabs(Number(event.target.value) || 1)}
                />
              </label>
              <p className="text-xs leading-relaxed text-muted">
                RTSP, MJPEG, or a snapshot URL. The server opens the camera
                directly, so it has to be reachable from the backend.
              </p>
              <Button
                variant="primary"
                disabled={Boolean(busy) || !cameraUrl.trim()}
                onClick={() => void submitCamera()}
              >
                Fetch stills
              </Button>
            </div>
          )}

          {busy && <LoadingState label={busy} />}
          {actionError && <ErrorNote message={actionError} />}
        </div>
      </Dialog>
    </div>
  )
}
