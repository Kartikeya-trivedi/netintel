import { useRef, type KeyboardEvent } from 'react'
import type { Alert } from '../../api/types'
import { SeverityLabel } from '../../ui/Identity'
import {
  eventDate,
  shortAmount,
  shortDate,
  signalMetric,
  signalSubject,
  SIGNAL_TYPES,
} from './model'

export default function SignalQueue({
  alerts,
  selectedId,
  onSelect,
}: {
  alerts: Alert[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const list = useRef<HTMLOListElement>(null)
  function navigate(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-signal]',
      ) ?? [],
    )
    if (!buttons.length) return
    const current = buttons.findIndex(
      (button) => button === document.activeElement,
    )
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.max(
              0,
              Math.min(
                buttons.length - 1,
                current + (event.key === 'ArrowDown' ? 1 : -1),
              ),
            )
    event.preventDefault()
    buttons[next].focus()
    onSelect(Number(buttons[next].dataset.signal))
  }
  return (
    <section className="signal-queue" aria-label="Signal queue">
      <div className="signal-queue-heading">
        <span>Event</span>
        <span>High priority first</span>
      </div>
      <ol ref={list} onKeyDown={navigate}>
        {alerts.map((alert) => {
          const metric = signalMetric(alert)
          return (
            <li key={alert.id}>
              <button
                type="button"
                data-signal={alert.id}
                className="signal-row"
                aria-current={selectedId === alert.id ? 'true' : undefined}
                aria-controls="signal-reader"
                onClick={() => onSelect(alert.id)}
              >
                <span className="signal-row-top">
                  <SeverityLabel level={alert.severity} />
                  <span className="signal-row-date">
                    {shortDate(eventDate(alert)).replace(/ 20\d\d$/, '')}
                  </span>
                </span>
                <span className="signal-row-type">
                  {SIGNAL_TYPES[alert.alert_type] ?? alert.alert_type}
                </span>
                <span className="signal-row-subject">
                  {signalSubject(alert)}
                </span>
                {metric && (
                  <span className="signal-row-metric">
                    <strong>{shortAmount(metric.value)}</strong>
                    <span>{metric.unit}</span>
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
      {alerts.length === 0 && (
        <p className="signal-no-match">No signals match this filter.</p>
      )}
    </section>
  )
}
