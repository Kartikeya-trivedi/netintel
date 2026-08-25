import { useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import type { EntityType } from '../api/types'
import EntityBadge from '../components/EntityBadge'
import HighlightedText from '../components/HighlightedText'
import { Empty, ErrorNote, Legend, Spinner } from '../components/Instrument'
import { useCase } from '../lib/CaseContext'
import { useAsync } from '../lib/useApi'

const DOC_TYPES = [
  { value: 'report', label: 'Report' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'call_records', label: 'Call records' },
  { value: 'subscriber_records', label: 'Subscribers' },
]

const STATUS_STYLES: Record<string, string> = {
  processed: 'text-ent-org',
  processing: 'text-signal',
  pending: 'text-ink-500',
  failed: 'text-sev-high',
}

export default function Documents() {
  const { activeCase, reload: reloadCases } = useCase()
  const caseId = activeCase?.id ?? null

  const [docType, setDocType] = useState('report')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [activeEntity, setActiveEntity] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const documents = useAsync(() => api.listDocuments(caseId!), [caseId], {
    enabled: caseId !== null,
  })
  const entities = useAsync(() => api.listEntities(caseId!), [caseId], {
    enabled: caseId !== null,
  })
  const detail = useAsync(
    () => api.getDocument(caseId!, selectedId!),
    [caseId, selectedId],
    { enabled: caseId !== null && selectedId !== null },
  )

  const typeByEntity = useMemo(
    () => new Map((entities.data ?? []).map((e) => [e.id, e.entity_type as EntityType])),
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
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)_252px]">
      <aside className="flex min-h-0 flex-col border-r hairline">
        <div className="border-b hairline p-4">
          <Legend>Ingest</Legend>

          <div className="mt-2 flex flex-wrap gap-1">
            {DOC_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDocType(option.value)}
                className={`border px-2 py-1 font-cond text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                  docType === option.value
                    ? 'border-signal bg-signal/15 text-signal'
                    : 'hairline text-ink-500 hover:text-ink-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void handleUpload(event.dataTransfer.files)
            }}
            className="mt-3 flex cursor-pointer flex-col items-center justify-center border border-dashed border-ink-800 px-3 py-6 text-center transition-colors hover:border-signal/60"
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files)}
            />
            <span className="font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
              Drop files or browse
            </span>
            <span className="mt-1 text-[11px] text-ink-700">txt · pdf · docx · csv</span>
          </label>

          <button
            type="button"
            onClick={seedDemo}
            className="mt-2 w-full border hairline py-1.5 font-cond text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400 transition-colors hover:border-signal hover:text-signal"
          >
            Reset demo case
          </button>

          {busy && <div className="mt-3"><Spinner label={busy} /></div>}
          {uploadError && <div className="mt-3"><ErrorNote message={uploadError} /></div>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <Legend>Sources · {documents.data?.length ?? 0}</Legend>
          </div>
          <ul>
            {(documents.data ?? []).map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(doc.id)
                    setActiveEntity(null)
                  }}
                  className={`flex w-full items-center gap-2 border-l-2 px-4 py-2 text-left transition-colors ${
                    selectedId === doc.id
                      ? 'border-signal bg-ink-900'
                      : 'border-transparent hover:bg-ink-950'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-200">
                    {doc.filename}
                  </span>
                  <span
                    className={`font-cond text-[9px] font-semibold uppercase tracking-[0.1em] ${
                      STATUS_STYLES[doc.status] ?? 'text-ink-500'
                    }`}
                  >
                    {doc.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {documents.data?.length === 0 && (
            <Empty>No sources ingested yet. Reset the demo case to load Operation Nightfall.</Empty>
          )}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {selectedId === null && (
          <Empty>
            Select a source to read it with every extracted entity marked in place.
          </Empty>
        )}
        {detail.loading && (
          <div className="p-6">
            <Spinner label="Loading source" />
          </div>
        )}
        {detail.error && (
          <div className="p-6">
            <ErrorNote message={detail.error} />
          </div>
        )}

        {detail.data && (
          <article className="mx-auto max-w-3xl px-8 py-7">
            <header className="border-b hairline pb-4">
              <h1 className="font-mono text-sm text-ink-100">{detail.data.filename}</h1>
              <div className="mt-2 flex items-center gap-4">
                <Legend>{detail.data.doc_type.replace(/_/g, ' ')}</Legend>
                <Legend>{detail.data.mentions.length} mentions</Legend>
                <Legend className={STATUS_STYLES[detail.data.status]}>
                  {detail.data.status}
                </Legend>
              </div>
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
                <Empty>
                  Structured records have no narrative text. Their rows became
                  transactions, call events, and ownership links in the graph.
                </Empty>
              )}
            </div>
          </article>
        )}
      </section>

      <aside className="min-h-0 overflow-y-auto border-l hairline">
        <div className="border-b hairline px-4 py-3">
          <Legend>Entities found · {documentEntities.length}</Legend>
        </div>
        <ul>
          {documentEntities.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() =>
                  setActiveEntity((current) => (current === entity.id ? null : entity.id))
                }
                className={`flex w-full items-center gap-2 px-4 py-2 text-left transition-colors ${
                  activeEntity === entity.id ? 'bg-signal/10' : 'hover:bg-ink-950'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                  {entity.canonical_name}
                </span>
                <EntityBadge type={entity.entity_type} />
              </button>
              {entity.aliases.length > 0 && (
                <p className="px-4 pb-2 text-[11px] text-ink-700">
                  aka {entity.aliases.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
        {selectedId !== null && documentEntities.length === 0 && !detail.loading && (
          <Empty>No entities extracted from this source.</Empty>
        )}
      </aside>
    </div>
  )
}
