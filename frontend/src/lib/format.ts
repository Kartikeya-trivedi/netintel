import type { Evidence } from '../api/investigation'

/** Display formatting for the investigation views.
 *
 *  Every time the API stores is UTC; everything a person reads is Indian
 *  Standard Time and says so. Some API stamps are naive (no offset) but are
 *  still UTC, so they are pinned before parsing rather than left to whatever
 *  zone the browser happens to be in.
 */

/** IST (Asia/Kolkata) has no daylight saving, so a fixed offset is exact.
 *  Dates are composed from it by arithmetic rather than Intl: browsers
 *  disagree on short month names ("Sep" or "Sept"), and the API's own
 *  summaries use the three-letter forms. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const amountFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null
  let text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00Z'
  // Microseconds are more precision than Date keeps; an offset-less stamp is UTC.
  text = text.replace(/(\.\d{3})\d+/, '$1')
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export function parseMs(value: string | null | undefined): number | null {
  return parseTime(value)?.getTime() ?? null
}

function toDate(value: string | Date | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return new Date(value)
  return parseTime(value)
}

interface DayParts {
  day: string
  month: string
  year: string
  hh: string
  mm: string
}

function parts(date: Date): DayParts {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return {
    day: String(ist.getUTCDate()),
    month: MONTHS[ist.getUTCMonth()],
    year: String(ist.getUTCFullYear()),
    hh: String(ist.getUTCHours()).padStart(2, '0'),
    mm: String(ist.getUTCMinutes()).padStart(2, '0'),
  }
}

/** "12 May 2026" */
export function formatDate(value: string | Date | number | null | undefined, unknown = 'date not stated'): string {
  const date = toDate(value)
  if (!date) return unknown
  const p = parts(date)
  return `${p.day} ${p.month} ${p.year}`
}

/** "12 May 2026, 14:05 IST" */
export function formatDateTime(
  value: string | Date | number | null | undefined,
  unknown = 'time not stated',
): string {
  const date = toDate(value)
  if (!date) return unknown
  const p = parts(date)
  return `${p.day} ${p.month} ${p.year}, ${p.hh}:${p.mm} IST`
}

/** "14:05 IST" */
export function formatTime(value: string | Date | number | null | undefined): string {
  const date = toDate(value)
  if (!date) return 'time not stated'
  const p = parts(date)
  return `${p.hh}:${p.mm} IST`
}

/** "12 May" */
export function formatDayMonth(value: string | Date | number): string {
  const date = toDate(value)
  if (!date) return ''
  const p = parts(date)
  return `${p.day} ${p.month}`
}

/** "May 2026" */
export function formatMonthYear(value: string | Date | number): string {
  const date = toDate(value)
  if (!date) return ''
  const p = parts(date)
  return `${p.month} ${p.year}`
}

/** A span of days, printed as tightly as it reads: "8–12 May 2026",
 *  "28 Apr – 3 May 2026", "28 Dec 2025 – 3 Jan 2026". */
export function formatRange(
  from: string | Date | number | null | undefined,
  to: string | Date | number | null | undefined,
): string {
  const a = toDate(from)
  const b = toDate(to)
  if (!a && !b) return 'dates not stated'
  if (!a) return `until ${formatDate(b)}`
  if (!b) return `from ${formatDate(a)}`
  const pa = parts(a)
  const pb = parts(b)
  if (pa.year !== pb.year) return `${formatDate(a)} – ${formatDate(b)}`
  if (pa.month !== pb.month) return `${pa.day} ${pa.month} – ${pb.day} ${pb.month} ${pb.year}`
  if (pa.day !== pb.day) return `${pa.day}–${pb.day} ${pb.month} ${pb.year}`
  return formatDate(a)
}

/** Calendar day in IST, as a sortable key: "2026-05-08". */
export function istDayKey(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MS)
  return shifted.toISOString().slice(0, 10)
}

/** Rupees in Indian grouping: "Rs. 1,20,000". */
export function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return 'amount not stated'
  return `Rs. ${amountFormat.format(amount)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "1 document", "3 documents". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`
}

/** Where in its original a statement sits. */
export function formatLocator(locator: Evidence['locator'] | null | undefined): string {
  if (!locator) return 'location not stated'
  if (locator.kind === 'row' && locator.row !== undefined) return `row ${locator.row}`
  if (locator.start !== undefined && locator.end !== undefined) return `chars ${locator.start}–${locator.end}`
  if (locator.line !== undefined) return `line ${locator.line}`
  if (locator.key) return locator.key
  return 'location not stated'
}

/** "Broken Mirror BM-1: loan-app extortion" reads as "loan-app extortion"
 *  next to a chip that already says BM-1. */
export function shortCaseName(name: string, code: string): string {
  const marker = `${code}:`
  const at = name.indexOf(marker)
  return at >= 0 ? name.slice(at + marker.length).trim() || name : name
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
