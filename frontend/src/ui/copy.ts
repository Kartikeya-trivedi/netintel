import { formatDate, formatRange } from '../lib/format'

/** Format generated interface copy only. Never pass original evidence through this. */
export function readableDates(text: string): string {
  return text
    .replace(
      /\b(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\b/g,
      (_, from: string, to: string) => formatRange(from, to),
    )
    .replace(/\b\d{4}-\d{2}-\d{2}\b(?!T)/g, (value) => formatDate(value, value))
}
