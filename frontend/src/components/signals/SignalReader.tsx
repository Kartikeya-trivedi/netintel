import { useState } from 'react'
import { readableDates } from '../../ui/copy'
import type { Alert } from '../../api/types'
import { formatDateTime, formatDayMonth, formatTime } from '../../lib/format'
import { Direction, SeverityLabel } from '../../ui/Identity'
import {
  eventDate,
  formatAmount,
  numberField,
  shortAmount,
  shortDate,
  signalMetric,
  signalRecords,
  signalSubject,
  SIGNAL_TYPES,
  type RecordRow,
} from './model'

export default function SignalReader({
  alert,
  onBack,
  onInspect,
}: {
  alert: Alert
  onBack: () => void
  onInspect: () => void
}) {
  const [selection, setSelection] = useState<{
    alert: number
    index: number
  } | null>(null)
  const selectedRecord = selection?.alert === alert.id ? selection.index : null
  const rowId = (index: number) => `signal-${alert.id}-record-${index}`
  function inspectRecord(index: number) {
    setSelection({ alert: alert.id, index })
    const row = document.getElementById(rowId(index))
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const metric = signalMetric(alert)
  const baseline = numberField(alert.evidence, 'baseline_median')
  const ratio =
    metric && baseline !== null && baseline > 0 ? metric.value / baseline : null
  const records = signalRecords(alert)
  const isCalls = alert.alert_type === 'COMM_BURST'
  return (
    <article
      id="signal-reader"
      className="signal-reader"
      aria-labelledby="signal-title"
      tabIndex={-1}
    >
      <button type="button" className="signal-back" onClick={onBack}>
        <Direction kind="left" />
        All signals
      </button>
      <header className="signal-reader-heading">
        <div className="signal-reader-meta">
          <SeverityLabel level={alert.severity} />
          <span className="signal-status">{alert.status}</span>
        </div>
        <p className="signal-source-line">{signalSubject(alert)}</p>
        <h2 id="signal-title">
          {SIGNAL_TYPES[alert.alert_type] ?? alert.alert_type}
        </h2>
        <p className="signal-date-line">
          {shortDate(eventDate(alert))}
          <span>
            {alert.entity_ids.length}{' '}
            {alert.entity_ids.length === 1 ? 'entity' : 'entities'} involved
          </span>
        </p>
      </header>
      {metric && (
        <section
          className={`signal-measure signal-measure-${alert.severity}`}
          aria-label="Recorded signal measurement"
        >
          <div>
            <p>{metric.label}</p>
            <div className="signal-big-number">
              {formatAmount(metric.value)}
              {isCalls && <span>calls</span>}
            </div>
          </div>
          {ratio !== null && (
            <div className="signal-comparison">
              <span className="signal-ratio">
                {new Intl.NumberFormat('en', {
                  maximumFractionDigits: ratio < 10 ? 1 : 0,
                }).format(ratio)}
                <small>×</small>
              </span>
              <p>the typical day</p>
              <span>
                Baseline median {formatAmount(baseline!)}
                {isCalls ? ' calls' : ''}
              </span>
            </div>
          )}
          {alert.alert_type === 'STRUCTURING' && (
            <div className="signal-comparison">
              <span className="signal-ratio">
                {numberField(alert.evidence, 'count') ?? records.length}
              </span>
              <p>transfers flagged</p>
              <span>
                Rule threshold{' '}
                {formatAmount(numberField(alert.evidence, 'threshold') ?? 0)}
              </span>
            </div>
          )}
        </section>
      )}
      <div className="signal-reader-body">
        {alert.description && (
          <p className="signal-explanation">
            {readableDates(alert.description)}
          </p>
        )}
        {records.length > 0 && (
          <RecordPlot
            alert={alert}
            rows={records}
            selected={selectedRecord}
            onInspect={inspectRecord}
          />
        )}
        <div className="signal-record-heading">
          <h3>Source records</h3>
          <span>
            {records.length ? `${records.length} supplied` : 'Recorded fields'}
          </span>
        </div>
        {records.length > 0 ? (
          <RecordTable
            rows={records}
            calls={isCalls}
            selected={selectedRecord}
            rowId={rowId}
          />
        ) : (
          <EvidenceFields evidence={alert.evidence} />
        )}
        <details className="signal-raw">
          <summary>
            All recorded fields<span aria-hidden="true">+</span>
          </summary>
          <EvidenceFields evidence={alert.evidence} />
        </details>
        <footer className="signal-reader-footer">
          <span>Raised {formatDateTime(alert.created_at)}</span>
          <button type="button" className="action-link" onClick={onInspect}>
            Inspect network
            <Direction kind="up-right" />
          </button>
        </footer>
      </div>
    </article>
  )
}

function RecordPlot({
  alert,
  rows,
  selected,
  onInspect,
}: {
  alert: Alert
  rows: RecordRow[]
  selected: number | null
  onInspect: (index: number) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const calls = alert.alert_type === 'COMM_BURST'
  const points = rows
    .map((row, index) => ({
      row,
      index,
      value: numberField(row, calls ? 'duration_sec' : 'amount'),
    }))
    .filter(
      (point): point is { row: RecordRow; index: number; value: number } =>
        point.value !== null,
    )
  if (!points.length) return null
  const threshold =
    alert.alert_type === 'STRUCTURING'
      ? numberField(alert.evidence, 'threshold')
      : null
  const rawMaximum =
    Math.max(...points.map((point) => point.value), threshold ?? 0, 1) * 1.15
  const magnitude = 10 ** Math.floor(Math.log10(rawMaximum))
  const maximum = (Math.ceil((rawMaximum / magnitude) * 2) / 2) * magnitude
  const width = 720,
    top = 30,
    bottom = 192,
    left = 58,
    right = 710,
    height = bottom - top
  const slot = (right - left) / points.length,
    barWidth = Math.min(slot * 0.64, 42)
  const total = numberField(alert.evidence, 'count')
  const current = points.find((point) => point.index === (hovered ?? selected))
  return (
    <figure className="record-plot">
      <figcaption>
        <strong>{calls ? 'Call durations' : 'Transfer amounts'}</strong>
        <span>
          {total !== null && total > rows.length
            ? `${rows.length} of ${total} records supplied`
            : `${rows.length} recorded ${calls ? 'calls' : 'transfers'}`}
        </span>
      </figcaption>
      <div className="plot-readout" aria-live="polite">
        {current ? (
          <>
            <strong>
              {formatAmount(current.value)}
              {calls ? ' seconds' : ''}
            </strong>
            <span>
              {typeof current.row.timestamp === 'string'
                ? formatDateTime(current.row.timestamp)
                : `Record ${current.index + 1}`}
            </span>
            <span>Enter or click to inspect</span>
          </>
        ) : (
          <span>Select a bar to inspect its source record.</span>
        )}
      </div>
      <div
        className="record-plot-scroll"
        tabIndex={0}
        role="region"
        aria-label="Record chart"
      >
        <svg
          viewBox={`0 0 ${width} 242`}
          role="group"
          aria-label={`${calls ? 'Duration in seconds for' : 'Amount of'} each supplied record, in source order. Arrow keys move between bars; Enter opens the source row.`}
        >
          <text x={left} y={13} className="plot-axis-title">
            {calls ? 'Seconds' : 'Amount'}
          </text>
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={left}
                x2={right}
                y1={bottom - height * fraction}
                y2={bottom - height * fraction}
                className="plot-rule"
              />
              <text
                x={left - 10}
                y={bottom - height * fraction + 4}
                textAnchor="end"
                className="plot-tick"
              >
                {shortAmount(maximum * fraction)}
              </text>
            </g>
          ))}
          {points.map(({ row, index, value }, i) => {
            const x = left + i * slot + (slot - barWidth) / 2,
              h = (value / maximum) * height
            const time =
              typeof row.timestamp === 'string'
                ? formatTime(row.timestamp).replace(' IST', '')
                : String(index + 1)
            const label =
              alert.alert_type === 'STRUCTURING' &&
              typeof row.timestamp === 'string'
                ? formatDayMonth(row.timestamp)
                : time
            return (
              <g
                key={index}
                className="plot-point"
                data-active={current?.index === index}
                role="button"
                tabIndex={0}
                aria-label={`Inspect record ${index + 1}, ${label}: ${formatAmount(value)}${calls ? ' seconds' : ''}`}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                onClick={() => onInspect(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onInspect(index)
                  }
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault()
                    const bars =
                      event.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>(
                        '.plot-point',
                      )
                    bars?.[
                      (i +
                        (event.key === 'ArrowRight' ? 1 : -1) +
                        points.length) %
                        points.length
                    ]?.focus()
                  }
                }}
              >
                <title>
                  {label}: {formatAmount(value)}
                  {calls ? ' seconds' : ''}
                </title>
                <rect
                  x={left + i * slot}
                  y={top - 6}
                  width={slot}
                  height={height + 40}
                  className="plot-hit"
                />
                <rect
                  x={x}
                  y={bottom - h}
                  width={barWidth}
                  height={h}
                  rx="2"
                  className="plot-bar"
                />
                {(points.length <= 8 ||
                  i % 2 === 0 ||
                  i === points.length - 1) && (
                  <text
                    x={x + barWidth / 2}
                    y={bottom + 22}
                    textAnchor="middle"
                    className="plot-tick"
                  >
                    {label}
                  </text>
                )}
              </g>
            )
          })}
          {threshold !== null && (
            <g className="plot-threshold-label">
              <line
                x1={left}
                x2={right}
                y1={bottom - (threshold / maximum) * height}
                y2={bottom - (threshold / maximum) * height}
                className="plot-threshold"
              />
              <text x={right} y={13} textAnchor="end" className="plot-tick">
                Threshold {formatAmount(threshold)}
              </text>
            </g>
          )}
          <text x={right} y={239} textAnchor="end" className="plot-axis-title">
            {alert.alert_type === 'STRUCTURING'
              ? 'Date (IST)'
              : 'Time (IST) · source order'}
          </text>
        </svg>
      </div>
    </figure>
  )
}

function RecordTable({
  rows,
  calls,
  selected,
  rowId,
}: {
  rows: RecordRow[]
  calls: boolean
  selected: number | null
  rowId: (index: number) => string
}) {
  return (
    <div
      className="signal-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={calls ? 'Call records' : 'Transfer records'}
    >
      <table className="signal-record-table">
        <thead>
          <tr>
            <th>{calls ? 'Caller' : 'Reference'}</th>
            <th>{calls ? 'Recipient' : 'To account'}</th>
            <th>{calls ? 'Seconds' : 'Amount'}</th>
            <th>Recorded at (IST)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              id={rowId(index)}
              tabIndex={-1}
              className={selected === index ? 'is-selected' : undefined}
            >
              <td>{String(row[calls ? 'caller' : 'txn_ref'] ?? '—')}</td>
              <td>{String(row[calls ? 'callee' : 'to_account'] ?? '—')}</td>
              <td>
                {typeof row[calls ? 'duration_sec' : 'amount'] === 'number'
                  ? formatAmount(
                      row[calls ? 'duration_sec' : 'amount'] as number,
                    )
                  : '—'}
              </td>
              <td
                title={
                  typeof row.timestamp === 'string' ? row.timestamp : undefined
                }
              >
                {typeof row.timestamp === 'string'
                  ? `${formatDayMonth(row.timestamp)} · ${formatTime(row.timestamp).replace(' IST', '')}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EvidenceFields({ evidence }: { evidence: RecordRow }) {
  return (
    <dl className="signal-fields">
      {Object.entries(evidence).map(([key, value]) => (
        <div key={key}>
          <dt>{key.replace(/_/g, ' ')}</dt>
          <dd>
            {value !== null && typeof value === 'object' ? (
              <pre tabIndex={0} aria-label={key.replace(/_/g, ' ')}>
                {JSON.stringify(value, null, 2)}
              </pre>
            ) : (
              String(value ?? '—')
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
