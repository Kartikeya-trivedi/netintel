import { useId, useState } from 'react'

import { inv, type VerifyReport } from '../../api/investigation'
import { errorMessage, formatBytes, formatDateTime } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { CopyButton, ErrorNote, FieldLabel, LoadingState } from '../../ui'
import { Button, Callout, SectionHeading, Chip } from './shared'
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
  [
    'manifest.json',
    'Every other file with its SHA-256 digest, and what was exported.',
  ],
  [
    'signature.json',
    'Ed25519 signature over the manifest, with the signing key id.',
  ],
  [
    'finding.json',
    'The finding as computed: its explanations and search limits.',
  ],
  ['scenario.json', 'The decisions and assumptions it was computed under.'],
  ['artifacts.json', 'For each original: case, filename, kind and source.'],
  [
    'originals/<sha256>',
    'The original bytes of every document in the workspace.',
  ],
]

function publicKeyUrl(): string {
  const base = import.meta.env.VITE_API_BASE ?? ''
  try {
    return new URL(
      `${base}/api/receipts/public-key`,
      window.location.origin,
    ).toString()
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

async function signingKeyFingerprint() {
  const pem = await inv.publicKey()
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  )
  const key = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'Ed25519' },
    true,
    ['verify'],
  )
  const raw = await crypto.subtle.exportKey('raw', key)
  const digest = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
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
  const [exported, setExported] = useState<{
    filename: string
    bytes: number
    at: number
  } | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const audit = useScopedAsync(() => inv.auditChain(), scope, [revision])
  const signingKey = useScopedAsync(signingKeyFingerprint, scope, [revision])

  const filename =
    exported?.filename ?? `netintel-${findingKey}-v${version ?? 'N'}.zip`
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
      const { blob, filename: name } = await inv.exportFinding(
        workspaceId,
        findingKey,
      )
      saveBlob(blob, name)
      setExported({ filename: name, bytes: blob.size, at: Date.now() })
    } catch (error) {
      setExportError(errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeading title="Export">
        A signed package of this finding as it stands at version{' '}
        {version ?? '—'}, with everything needed to check it and recompute it
        away from this system. Access is re-checked at the moment of export, and
        the export is written to the audit log.
      </SectionHeading>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={() => void exportPackage()}
              disabled={exporting}
            >
              {exporting ? 'Signing…' : 'Export signed package'}
            </Button>
            {exported && (
              <span role="status" className="text-xs text-body">
                Saved{' '}
                <span className="font-mono text-body">{exported.filename}</span>{' '}
                · <span className="numeric">{formatBytes(exported.bytes)}</span>{' '}
                · {formatDateTime(exported.at)}
              </span>
            )}
          </div>
          {exportError && <ErrorNote message={exportError} />}

          <div>
            <FieldLabel>Inside the package</FieldLabel>
            <dl className="mt-1.5 divide-y divide-border border border-border">
              {CONTENTS.map(([name, what]) => (
                <div
                  key={name}
                  className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3"
                >
                  <dt className="font-mono text-xs text-body">{name}</dt>
                  <dd className="text-xs text-body">{what}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Independent check</FieldLabel>
              <CopyButton value={command} label="Copy commands" />
            </div>
            <pre
              tabIndex={0}
              aria-label="Independent verification commands"
              className="relative mt-1.5 overflow-x-auto border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-body"
            >
              {command}
            </pre>
            <p className="mt-1.5 text-xs text-muted">
              Public key:{' '}
              <a
                href={keyUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-body underline decoration-muted underline-offset-2 hover:text-primary"
              >
                {keyUrl}
              </a>
              . Exit status 0 only when integrity is verified and, with{' '}
              <span className="font-mono">--reproduce</span>, the finding
              recomputes to the same result.
            </p>
          </div>

          <div className="rounded-md border border-border p-3">
            <FieldLabel>Server signing key · Ed25519</FieldLabel>
            {signingKey.loading && <LoadingState label="Reading public key" />}
            {signingKey.error && <ErrorNote message={signingKey.error} />}
            {signingKey.data && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-body">
                  Key ID{' '}
                  <code className="font-mono text-heading">
                    {signingKey.data.slice(0, 16)}
                  </code>
                </p>
                <p className="break-all font-mono text-xs text-muted">
                  SHA-256 {signingKey.data}
                </p>
                <CopyButton value={signingKey.data} label="Copy fingerprint" />
              </div>
            )}
          </div>

          <p className="text-xs text-body">
            <span className="field-label mr-2">Audit log</span>
            {audit.loading && !audit.data && 'checking…'}
            {audit.error && (
              <span className="text-sev-high">
                could not be checked: {audit.error}
              </span>
            )}
            {audit.data &&
              (audit.data.intact ? (
                <>
                  hash chain intact ·{' '}
                  <span className="numeric">{audit.data.events}</span> events ·
                  head{' '}
                  <span className="numeric">
                    {audit.data.head.slice(0, 12)}…
                  </span>
                </>
              ) : (
                <span className="text-sev-high">
                  hash chain broken at event{' '}
                  <span className="numeric">
                    {audit.data.broken_at ?? 'unknown'}
                  </span>
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
    <div className="min-w-0 space-y-3 border border-border bg-surface/60 p-3">
      <div>
        <FieldLabel>Check a package</FieldLabel>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Convenience check against this server's own key. It cannot vouch for a
          package this same server could have re-signed; for an independent
          check, use the command with a key you obtained separately.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center border border-[color:var(--color-border)] px-2.5 py-1 text-xs font-semibold text-body transition-colors focus-within:border-primary hover:border-primary hover:text-primary"
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
        <span className="min-w-0 truncate font-mono text-xs text-body">
          {file ? `${file.name} · ${formatBytes(file.size)}` : 'No file chosen'}
        </span>
      </div>

      <label className="flex items-start gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={reproduce}
          onChange={(event) => setReproduce(event.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span>
          Also recompute the finding from the included originals
          <span className="block text-xs text-muted">
            Slower: re-extracts every original from scratch.
          </span>
        </span>
      </label>

      <Button onClick={() => void check()} disabled={!file || checking}>
        {checking ? 'Checking…' : 'Check package'}
      </Button>

      {checking && (
        <LoadingState
          label={reproduce ? 'Verifying and recomputing' : 'Verifying'}
        />
      )}
      {error && <ErrorNote message={error} />}
      {report && <VerifyResult report={report} />}
    </div>
  )
}

const INTEGRITY_TONE: Record<
  VerifyReport['integrity'],
  'supported' | 'signal' | 'muted'
> = {
  verified: 'supported',
  failed: 'signal',
  unchecked: 'muted',
}

const REPRODUCTION_TONE: Record<
  VerifyReport['reproduction'],
  'supported' | 'signal' | 'muted'
> = {
  reproduced: 'supported',
  mismatch: 'signal',
  'not possible': 'muted',
  'not requested': 'muted',
}

function VerifyResult({ report }: { report: VerifyReport }) {
  const status =
    report.status === 'supported' ||
    report.status === 'lead' ||
    report.status === 'unsupported'
      ? statusLabel(report.status)
      : report.status
  return (
    <div role="status" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={INTEGRITY_TONE[report.integrity]}>
          Integrity: {report.integrity}
        </Chip>
        <Chip tone={REPRODUCTION_TONE[report.reproduction]}>
          Reproduction: {report.reproduction}
        </Chip>
      </div>
      {(report.title || report.finding) && (
        <p className="text-sm text-body">
          {report.title ?? report.finding}
          {status && <span className="text-muted"> · {status}</span>}
          {report.exported_at && (
            <span className="text-muted">
              {' '}
              · exported {formatDateTime(report.exported_at)}
            </span>
          )}
        </p>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {report.checks.map((check, index) => (
          <li
            key={`${check.check}-${index}`}
            className="flex items-start gap-2.5 px-2.5 py-1.5 text-xs"
          >
            <span
              className={`numeric w-8 shrink-0 text-center text-xs ${
                check.ok === true
                  ? 'text-status-supported'
                  : check.ok === false
                    ? 'text-primary'
                    : 'text-muted'
              }`}
            >
              {check.ok === true ? 'ok' : check.ok === false ? 'BAD' : '—'}
            </span>
            <span className="min-w-0">
              <span className="text-body">{check.check}</span>
              <span className="text-muted">: {check.detail}</span>
            </span>
          </li>
        ))}
        {report.checks.length === 0 && (
          <li className="px-2.5 py-1.5 text-xs text-muted">
            No checks reported.
          </li>
        )}
      </ul>
      <Callout>{report.scope}</Callout>
    </div>
  )
}
