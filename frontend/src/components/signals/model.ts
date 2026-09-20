import type { Alert } from '../../api/types'

export const SIGNAL_TYPES: Record<string, string> = {
  TRANSACTION_SPIKE: 'Transaction spike', STRUCTURING: 'Split transfers', CCTV_SIGHTING: 'Camera sighting',
  COMM_BURST: 'Call burst', NEW_LINK: 'New connection', HIGH_CENTRALITY_SHIFT: 'Network shift',
}

export type RecordRow = Record<string, unknown>

export function numberField(evidence: RecordRow, key: string): number | null {
  const value = evidence[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function signalRecords(alert: Alert): RecordRow[] {
  const rows = alert.evidence.transactions ?? alert.evidence.calls
  return Array.isArray(rows) ? rows.filter((row): row is RecordRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : []
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
}

export function shortAmount(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

export function signalSubject(alert: Alert): string {
  if (typeof alert.evidence.account === 'string') return `Account ${alert.evidence.account}`
  if (Array.isArray(alert.evidence.pair)) return alert.evidence.pair.map(String).join(' / ')
  return alert.title
}

export function signalMetric(alert: Alert): { value: number; unit: string; label: string } | null {
  if (alert.alert_type === 'COMM_BURST') {
    const count = numberField(alert.evidence, 'count')
    return count === null ? null : { value: count, unit: 'calls', label: 'Calls in one day' }
  }
  const total = numberField(alert.evidence, 'day_total') ?? numberField(alert.evidence, 'total')
  return total === null ? null : { value: total, unit: 'transferred', label: alert.alert_type === 'STRUCTURING' ? 'Combined transfer amount' : 'Total transferred that day' }
}

export function eventDate(alert: Alert): string {
  const value = alert.evidence.day
  const firstRecord = signalRecords(alert)[0]?.timestamp
  return typeof value === 'string' ? value : typeof firstRecord === 'string' ? firstRecord : alert.created_at
}

export function shortDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
