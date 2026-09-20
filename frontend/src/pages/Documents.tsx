import { useEffect, useMemo, useRef, useState } from 'react'

import { Plus, Search } from '../ui/Symbols'
import { api } from '../api/client'
import type { EntityType } from '../api/types'
import EntityBadge from '../components/EntityBadge'
import HighlightedText from '../components/HighlightedText'
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
import { Direction, FileStamp } from '../ui/Identity'

const DOC_TYPES = [
  { value: 'report', label: 'Report' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'call_records', label: 'Call records' },
  { value: 'subscriber_records', label: 'Subscribers' },
]

const STATUS_STYLES: Record<string, string> = {
  processed: 'text-ent-org',
  processing: 'text-primary',
  pending: 'text-muted',
  failed: 'text-sev-high',
}

export default function Documents() {
  const { activeCase, reload: reloadCases, version } = useCase()
  const caseId = activeCase?.id ?? null

  const [uploadOpen, setUploadOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [docType, setDocType] = useState('report')
  const [selection, setSelection] = useState<{
    caseId: number
    id: number
  } | null>(null)
  const selectedId = selection?.caseId === caseId ? selection.id : null
  const setSelectedId = (id: number | null) =>
    setSelection(id !== null && caseId !== null ? { caseId, id } : null)
  const [activeEntity, setActiveEntity] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const reader = useRef<HTMLElement>(null)
  const lastDocument = useRef<number | null>(null)
  useEffect(() => {
    if (selectedId !== null) lastDocument.current = selectedId
    if (
      selectedId !== null &&
      window.matchMedia('(max-width: 1023px)').matches
    ) {
      reader.current?.focus({ preventScroll: true })
      reader.current?.scrollIntoView({ block: 'start' })
    }
  }, [selectedId, caseId])
  function backToSources() {
    setSelectedId(null)
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `button[data-document="${lastDocument.current}"]`,
        )
        ?.focus(),
    )
  }

  const documents = useScopedAsync(
    () => api.listDocuments(caseId!),
    `case:${caseId}`,
    [version],
    {
      enabled: caseId !== null,
    },
  )
  const entities = useScopedAsync(
    () => api.listEntities(caseId!),
    `case:${caseId}`,
    [version],
    {
      enabled: caseId !== null,
    },
  )
  const detail = useScopedAsync(
    () => api.getDocument(caseId!, selectedId!),
    `case:${caseId}:document:${selectedId}`,
    [version],
    { enabled: caseId !== null && selectedId !== null },
  )

  const typeByEntity = useMemo(
    () =>
      new Map(
        (entities.data ?? []).map((e) => [e.id, e.entity_type as EntityType]),
      ),
    [entities.data],
  )
  const entityById = useMemo(
    () => new Map((entities.data ?? []).map((e) => [e.id, e])),
    [entities.data],
  )

  // Distinct entities named in the open document, ordered by first appearance.
  const documentEntities = useMemo(() => {
    const seen = new Set<number>()
    return (detail.data?.mentions ?? [])
      .slice()
      .sort((a, b) => a.span_start - b.span_start)
      .filter((m) => (seen.has(m.entity_id) ? false : seen.add(m.entity_id)))
      .map((m) => entityById.get(m.entity_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
  }, [detail.data, entityById])

  async function handleUpload(files: FileList | null) {
    if (!files?.length || caseId === null) return
    setUploadError(null)
    try {
      for (const file of Array.from(files)) {
        setBusy(`Ingesting ${file.name}`)
        await api.uploadDocument(caseId, file, docType)
      }
      setUploadOpen(false)
      // Extraction runs in the background, so give it a beat before re-reading.
      setTimeout(() => {
        documents.reload()
        entities.reload()
      }, 900)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function seedDemo() {
    setBusy('Seeding Operation Nightfall')
    setUploadError(null)
    try {
      await api.resetDemo()
      reloadCases()
      documents.reload()
      entities.reload()
      setSelectedId(null)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="documents-layout" data-reading={selectedId !== null}>
      <aside
        className="min-w-0 border-r border-border bg-surface"
        aria-label="Source library"
      >
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-heading">Sources</h1>
              <p className="mt-1 text-xs text-muted">
                The evidence behind every link.
              </p>
            </div>
          </div>
          <Button
            className="mt-5 w-full"
            variant="primary"
            onClick={() => setUploadOpen(true)}
            disabled={caseId === null}
          >
            <Plus size={16} />
            Add source
          </Button>
          <label className="relative mt-4 block">
            <Search
              size={15}
              className="absolute left-3 top-3 text-muted"
              aria-hidden="true"
            />
            <span className="sr-only">Search sources</span>
            <input
              type="search"
              placeholder="Find a document"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full pl-9!"
            />
          </label>
        </div>
        <div className="flex items-center justify-between px-5 pb-2 text-xs text-muted">
          <span>All sources</span>
          <span className="numeric">{documents.data?.length ?? 0}</span>
        </div>
        {documents.loading && (
          <div className="px-5">
            <LoadingState label="Reading sources" />
          </div>
        )}
        {documents.error && (
          <div className="p-4">
            <ErrorNote message={documents.error} />
          </div>
        )}
        <ul className="max-h-[440px] overflow-y-auto px-3 pb-4 xl:max-h-none">
          {(documents.data ?? [])
            .filter((doc) =>
              doc.filename.toLowerCase().includes(query.toLowerCase()),
            )
            .map((doc) => (
              <li key={doc.id}>
                <button
                  data-document={doc.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(doc.id)
                    setActiveEntity(null)
                  }}
                  aria-current={selectedId === doc.id ? 'true' : undefined}
                  className="source-row"
                >
                  <FileStamp filename={doc.filename} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-semibold text-heading">
                      {doc.filename}
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                      <span>{doc.doc_type.replace(/_/g, ' ')}</span>
                      <span
                        className={`inline-flex items-center gap-1 ${STATUS_STYLES[doc.status] ?? 'text-muted'}`}
                      >
                        {doc.status}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
        {documents.data?.length === 0 && (
          <EmptyNote>
            No sources yet. Add a document or load the synthetic demo.
          </EmptyNote>
        )}
        {documents.data &&
          documents.data.length > 0 &&
          !documents.data.some((doc) =>
            doc.filename.toLowerCase().includes(query.toLowerCase()),
          ) && <EmptyNote>No documents match this search.</EmptyNote>}
        <div className="border-t border-border p-4">
          <Button
            className="w-full"
            onClick={() => void seedDemo()}
            disabled={Boolean(busy)}
          >
            {busy ? 'Loading…' : 'Reset demo case'}
          </Button>
          {busy && <LoadingState label={busy} />}{' '}
          {uploadError && (
            <div className="mt-3">
              <ErrorNote message={uploadError} />
            </div>
          )}
        </div>
      </aside>
      <section
        ref={reader}
        tabIndex={-1}
        className="source-reader"
        aria-label="Source reader"
      >
        <button type="button" className="source-back" onClick={backToSources}>
          <Direction kind="left" />
          All sources
        </button>
        {selectedId === null && (
          <div className="source-empty">
            <span className="source-empty-rule" aria-hidden="true" />
            <h2 className="text-2xl font-bold text-heading">Open a source</h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
              Read the original record and inspect the entities it names.
            </p>
            {documents.data?.[0] && (
              <Button
                variant="quiet"
                className="mt-6"
                onClick={() => setSelectedId(documents.data![0].id)}
              >
                Read newest source
                <Direction />
              </Button>
            )}
            {Boolean(documents.data?.length) && (
              <div className="source-starters">
                <h3>Recent sources</h3>
                {documents.data!.slice(0, 3).map((doc) => (
                  <button
                    type="button"
                    key={doc.id}
                    onClick={() => {
                      setSelectedId(doc.id)
                      setActiveEntity(null)
                    }}
                  >
                    <FileStamp filename={doc.filename} />
                    <span>
                      <strong>{doc.filename}</strong>
                      <small>
                        {doc.doc_type.replace(/_/g, ' ')} · {doc.status}
                      </small>
                    </span>
                    <Direction />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {detail.loading && <LoadingPane label="Opening source" />}
        {detail.error && <ErrorNote message={detail.error} />}
        {detail.data && (
          <article className="source-paper">
            <header className="border-b border-border pb-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip>{detail.data.doc_type.replace(/_/g, ' ')}</Chip>
                <Chip
                  tone={
                    detail.data.status === 'processed' ? 'supported' : 'neutral'
                  }
                >
                  {detail.data.status}
                </Chip>
              </div>
              <h2 className="break-words text-xl font-bold text-heading">
                {detail.data.filename}
              </h2>
              <p className="mt-3 text-xs text-muted">
                {detail.data.mentions.length} extracted mentions · Select a
                highlighted name to inspect it
              </p>
              {detail.data.error && (
                <div className="mt-3">
                  <ErrorNote message={detail.data.error} />
                </div>
              )}
            </header>
            <div className="mt-6">
              {detail.data.raw_text ? (
                <HighlightedText
                  text={detail.data.raw_text}
                  mentions={detail.data.mentions}
                  typeByEntity={typeByEntity}
                  activeEntityId={activeEntity}
                  onSelect={setActiveEntity}
                />
              ) : (
                <EmptyNote>
                  Structured records have no narrative text. Their rows became
                  transactions, call events, and ownership links in the graph.
                </EmptyNote>
              )}
            </div>
          </article>
        )}
      </section>
      <aside
        className="document-entities min-w-0 border-l border-border bg-surface p-4"
        aria-label="Extracted entities"
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-bold text-heading">People & entities</h2>
          <span className="ml-auto text-xs text-muted">
            {documentEntities.length}
          </span>
        </div>
        <ul className="space-y-1">
          {documentEntities.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() =>
                  setActiveEntity((current) =>
                    current === entity.id ? null : entity.id,
                  )
                }
                aria-pressed={activeEntity === entity.id}
                className={`w-full rounded-lg p-2.5 text-left ${activeEntity === entity.id ? 'bg-primary-soft' : 'hover:bg-subtle'}`}
              >
                <span className="mb-2 block text-sm font-semibold text-heading">
                  {entity.canonical_name}
                </span>
                <EntityBadge type={entity.entity_type} />
              </button>
              {entity.aliases.length > 0 && (
                <p className="px-2.5 pb-2 text-xs text-muted">
                  Also {entity.aliases.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
        {documentEntities.length === 0 && !detail.loading && (
          <p className="text-xs leading-relaxed text-muted">
            {selectedId === null
              ? 'Entities from the selected document will appear here.'
              : 'No entities were extracted from this source.'}
          </p>
        )}
      </aside>
      <Dialog
        open={uploadOpen}
        title="Add evidence to this case"
        onClose={() => setUploadOpen(false)}
      >
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Add reports or structured records. NetIntel extracts entities and
            connects them to the case.
          </p>
          <label className="block">
            <FieldLabel>Source type</FieldLabel>
            <select
              className="mt-2 block w-full"
              value={docType}
              onChange={(event) => setDocType(event.target.value)}
            >
              {DOC_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void handleUpload(event.dataTransfer.files)
            }}
            className="flex flex-col items-center rounded-xl border-2 border-dashed border-line bg-primary-soft px-5 py-10 text-center"
          >
            <p className="mb-4 text-sm text-heading">Drop your files here</p>
            <Button
              variant="primary"
              disabled={Boolean(busy)}
              onClick={() => fileInput.current?.click()}
            >
              Browse files
            </Button>
            <p className="mt-3 text-xs text-muted">TXT · PDF · DOCX · CSV</p>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files)}
            />
          </div>
          {busy && <LoadingState label={busy} />}{' '}
          {uploadError && <ErrorNote message={uploadError} />}
        </div>
      </Dialog>
    </div>
  )
}
