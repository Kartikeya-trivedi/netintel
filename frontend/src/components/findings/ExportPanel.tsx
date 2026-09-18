import { useId, useState } from 'react'

import { inv, type VerifyReport } from '../../api/investigation'
import { errorMessage, formatBytes, formatDateTime } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { ErrorNote, Legend, Spinner } from '../Instrument'
import { ActionButton, Note, SectionHeading, Tag } from './Controls'
import { statusLabel } from './StatusBadge'

/** Export a signed, reproducible package of this finding, and check one.
 *
 *  Integrity says a package matches what the holder of a trusted key signed;
 *  it says nothing about whether a source is true. Reproduction says the
 *  stated result follows from the included originals under the stated
 *  decisions; it does not validate the investigative hypothesis. The check on
 *  this page uses this server's own key, which makes it a convenience: the
 *  independent check is the command-line verifier with a key fetched
 *  separately, and the page prints that command.
 */

const CONTENTS: [string, string][] = [
  ['manifest.json', 'Every other file with its SHA-256 digest, and what was exported.'],
  ['signature.json', 'Ed25519 signature over the manifest, with the signing key id.'],
  ['finding.json', 'The finding as computed: its explanations and search limits.'],
  ['scenario.json', 'The decisions and assumptions it was computed under.'],
  ['artifacts.json', 'For each original: case, filename, kind and source.'],
  ['originals/<sha256>', 'The original bytes of every document in the workspace.'],
]

function publicKeyUrl(): string {
  const base = import.meta.env.VITE_API_BASE ?? ''
  try {
    return new URL(`${base}/api/receipts/public-key`, window.location.origin).toString()
  } catch {
    return `${base}/api/receipts/public-key`
  }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function ExportPanel({
  workspaceId,
  findingKey,
  version,
  scope,
  revision,
}: {
  workspaceId: number
  findingKey: string
  version: number | null
  scope: string
  revision: number
}) {
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<{ filename: string; bytes: number; at: number } | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const audit = useScopedAsync(() => inv.auditChain(), scope, [revision])

  const filename = exported?.filename ?? `netintel-${findingKey}-v${version ?? 'N'}.zip`
  const keyUrl = publicKeyUrl()
  const command = [
    '# 1. Fetch the public key through a channel you trust, apart from the package',
    `curl -o key.pem ${keyUrl}`,
    '# 2. From the backend directory, check integrity and recompute the finding',
    `uv run python -m app.investigation.verify path/to/${filename} --public-key key.pem --reproduce`,
  ].join('\n')

  async function exportPackage() {
    setExporting(true)
    setExportError(null)
    try {
      const { blob, filename: name } = await inv.exportFinding(workspaceId, findingKey)
      saveBlob(blob, name)
      setExported({ filename: name, bytes: blob.size, at: Date.now() })
    } catch (error) {
      setExportError(errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeading title="Export">
        A signed package of this finding as it stands at version {version ?? '—'}, with everything needed to check
        it and recompute it away from this system. Access is re-checked at the moment of export, and the export is
        written to the audit log.
      </SectionHeading>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton variant="primary" onClick={() => void exportPackage()} disabled={exporting}>
              {exporting ? 'Signing…' : 'Export signed package'}
            </ActionButton>
            {exported && (
              <span role="status" className="text-[12px] text-ink-400">
                Saved <span className="font-mono text-ink-200">{exported.filename}</span> ·{' '}
                <span className="readout">{formatBytes(exported.bytes)}</span> · {formatDateTime(exported.at)}
              </span>
            )}
          </div>
          {exportError && <ErrorNote message={exportError} />}

          <div>
            <Legend>Inside the package</Legend>
            <dl className="mt-1.5 divide-y divide-rule border hairline">
              {CONTENTS.map(([name, what]) => (
                <div key={name} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 px-3 py-1.5">
                  <dt className="font-mono text-[11.5px] text-ink-200">{name}</dt>
                  <dd className="text-[12px] text-ink-400">{what}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Legend>Independent check</Legend>
              <ActionButton variant="link" onClick={() => void copyCommand()}>
                {copied ? 'Copied' : 'Copy commands'}
              </ActionButton>
            </div>
            <pre className="relative mt-1.5 overflow-x-auto border hairline bg-ink-950 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-200">
              {command}
            </pre>
            <p className="mt-1.5 text-[11.5px] text-ink-500">
              Public key:{' '}
              <a href={keyUrl} target="_blank" rel="noreferrer" className="font-mono text-ink-200 underline decoration-ink-700 underline-offset-2 hover:text-signal">
                {keyUrl}
              </a>
              . Exit status 0 only when integrity is verified and, with <span className="font-mono">--reproduce</span>,
              the finding recomputes to the same result.
            </p>
          </div>

          <p className="text-[12px] text-ink-400">
            <span className="legend mr-2">Audit log</span>
            {audit.loading && !audit.data && 'checking…'}
            {audit.error && <span className="text-sev-high">could not be checked: {audit.error}</span>}
            {audit.data &&
              (audit.data.intact ? (
                <>
                  hash chain intact · <span className="readout">{audit.data.events}</span> events · head{' '}
                  <span className="readout">{audit.data.head.slice(0, 12)}…</span>
                </>
              ) : (
                <span className="text-sev-high">
                  hash chain broken at event <span className="readout">{audit.data.broken_at ?? 'unknown'}</span>
                </span>
              ))}
          </p>
        </div>

        <PackageCheck />
      </div>
    </section>
  )
}

function PackageCheck() {
  const [file, setFile] = useState<File | null>(null)
  const [reproduce, setReproduce] = useState(true)
  const [checking, setChecking] = useState(false)
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  async function check() {
    if (!file) return
    setChecking(true)
    setError(null)
    setReport(null)
    try {
      setReport(await inv.verifyPackage(file, reproduce))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-3 border hairline bg-ink-950/60 p-3">
      <div>
        <Legend>Check a package</Legend>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
          Convenience check against this server's own key. It cannot vouch for a package this same server could
          have re-signed; for an independent check, use the command with a key you obtained separately.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center border border-[color:var(--rule-color)] px-2.5 py-1 font-cond text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-200 transition-colors focus-within:border-signal hover:border-signal hover:text-signal"
        >
          {file ? 'Choose another' : 'Choose package (.zip)'}
          <input
            id={inputId}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setReport(null)
              setError(null)
            }}
          />
        </label>
        <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-400">
          {file ? `${file.name} · ${formatBytes(file.size)}` : 'No file chosen'}
        </span>
      </div>

      <label className="flex items-start gap-2 text-[12.5px] text-ink-200">
        <input
          type="checkbox"
          checked={reproduce}
          onChange={(event) => setReproduce(event.target.checked)}
          className="mt-0.5 accent-signal"
        />
        <span>
          Also recompute the finding from the included originals
          <span className="block text-[11px] text-ink-500">Slower: re-extracts every original from scratch.</span>
        </span>
      </label>

      <ActionButton onClick={() => void check()} disabled={!file || checking}>
        {checking ? 'Checking…' : 'Check package'}
      </ActionButton>

      {checking && <Spinner label={reproduce ? 'Verifying and recomputing' : 'Verifying'} />}
      {error && <ErrorNote message={error} />}
      {report && <VerifyResult report={report} />}
    </div>
  )
}

const INTEGRITY_TONE: Record<VerifyReport['integrity'], 'supported' | 'signal' | 'muted'> = {
  verified: 'supported',
  failed: 'signal',
  unchecked: 'muted',
}

const REPRODUCTION_TONE: Record<VerifyReport['reproduction'], 'supported' | 'signal' | 'muted'> = {
  reproduced: 'supported',
  mismatch: 'signal',
  'not possible': 'muted',
  'not requested': 'muted',
}

function VerifyResult({ report }: { report: VerifyReport }) {
  const status = report.status === 'supported' || report.status === 'lead' || report.status === 'unsupported'
    ? statusLabel(report.status)
    : report.status
  return (
    <div role="status" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={INTEGRITY_TONE[report.integrity]}>Integrity: {report.integrity}</Tag>
        <Tag tone={REPRODUCTION_TONE[report.reproduction]}>Reproduction: {report.reproduction}</Tag>
      </div>
      {(report.title || report.finding) && (
        <p className="text-[12.5px] text-ink-200">
          {report.title ?? report.finding}
          {status && <span className="text-ink-500"> · {status}</span>}
          {report.exported_at && <span className="text-ink-500"> · exported {formatDateTime(report.exported_at)}</span>}
        </p>
      )}
      <ul className="divide-y divide-rule border hairline">
        {report.checks.map((check, index) => (
          <li key={`${check.check}-${index}`} className="flex items-start gap-2.5 px-2.5 py-1.5 text-[12px]">
            <span
              className={`readout w-8 shrink-0 text-center text-[11px] ${
                check.ok === true ? 'text-status-supported' : check.ok === false ? 'text-signal' : 'text-ink-500'
              }`}
            >
              {check.ok === true ? 'ok' : check.ok === false ? 'BAD' : '—'}
            </span>
            <span className="min-w-0">
              <span className="text-ink-200">{check.check}</span>
              <span className="text-ink-500">: {check.detail}</span>
            </span>
          </li>
        ))}
        {report.checks.length === 0 && <li className="px-2.5 py-1.5 text-[12px] text-ink-500">No checks reported.</li>}
      </ul>
      <Note>{report.scope}</Note>
    </div>
  )
}
