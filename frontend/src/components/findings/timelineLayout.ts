import type { Contrary, FindingDetail, Kind, Person } from '../../api/investigation'
import {
  DAY_MS,
  IST_OFFSET_MS,
  formatAmount,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatMonthYear,
  formatRange,
  istDayKey,
  parseMs,
  plural,
} from '../../lib/format'
import { readingsText, uniqueReadings } from './model'

/** Layout for the holdings-and-events timeline, kept apart from the drawing.
 *
 *  Pure functions of the response and a pixel width: which lanes exist and in
 *  what order, the time window each zoom shows, the axis ticks, how holdings
 *  stack when they overlap, where each day's event mark sits, and the words
 *  printed on and around them. TimelineLanes draws what this returns.
 */

export type Timeline = FindingDetail['timeline']
export type Zoom = 'events' | 'all'

export interface BarModel {
  key: string
  identifier: string
  person: string
  kind: Kind
  start: number | null
  end: number | null
  stated: number | null
  document: string | null
  active: boolean
  colour: number
}

export interface EventModel {
  key: string
  type: 'call' | 'transfer'
  at: number
  from: string
  to: string
  amount: number | null
  document: string | null
  readings: { source: string; target: string }[]
}

interface ConflictModel {
  identifier: string
  from: number
  to: number
  holders: string[]
  events: number
}

export interface LaneModel {
  identifier: string
  bars: BarModel[]
  events: EventModel[]
  conflicts: ConflictModel[]
  kind: string
  holders: string[]
}

export interface Model {
  lanes: LaneModel[]
  bars: BarModel[]
  events: EventModel[]
  undated: BarModel[]
}

export const PALETTE = 8
export const AXIS = 30
export const STRIP = 20
export const NOTE = 15
export const BAR = 18
const BAR_GAP = 4
const LANE_PAD = 8
const LANE_GAP = 8
export const FADE = 36
const RIGHT = 14
const CHAR = 5.7

export function buildModel(timeline: Timeline, contrary: Contrary[], people: Record<string, Person>): Model {
  const seenEvents = new Set<string>()
  const events: EventModel[] = []
  for (const event of timeline.events) {
    const at = parseMs(event.at)
    if (at === null || seenEvents.has(event.key)) continue
    seenEvents.add(event.key)
    events.push({ ...event, at, readings: uniqueReadings(event.readings) })
  }
  events.sort((a, b) => a.at - b.at)

  const conflicts: ConflictModel[] = []
  for (const item of contrary) {
    if (item.kind !== 'attribution' || !item.identifier) continue
    const from = parseMs(item.from)
    const to = parseMs(item.to)
    if (from === null || to === null) continue
    conflicts.push({
      identifier: item.identifier,
      from,
      to,
      holders: item.holders.map((key) => people[key]?.label ?? key),
      events: item.events ?? 0,
    })
  }

  const identifiers = new Set<string>()
  timeline.holdings.forEach((holding) => identifiers.add(holding.identifier))
  events.forEach((event) => {
    identifiers.add(event.from)
    identifiers.add(event.to)
  })

  const firstEvent = new Map<string, number>()
  for (const event of events) {
    for (const id of [event.from, event.to]) firstEvent.set(id, Math.min(firstEvent.get(id) ?? Infinity, event.at))
  }
  const disputed = new Set(conflicts.map((c) => c.identifier))
  const order = [...identifiers].sort(
    (a, b) =>
      Number(disputed.has(b)) - Number(disputed.has(a)) ||
      (firstEvent.get(a) ?? Infinity) - (firstEvent.get(b) ?? Infinity) ||
      a.localeCompare(b),
  )

  // Colours follow people, not lanes, so a number changing hands shows as a
  // change of colour along its lane.
  const colours = new Map<string, number>()
  const colourOf = (person: string) => {
    if (!colours.has(person)) colours.set(person, (colours.size % PALETTE) + 1)
    return colours.get(person) ?? 1
  }

  const allBars: BarModel[] = []
  const undated: BarModel[] = []
  const lanes: LaneModel[] = order.map((identifier) => {
    const bars = timeline.holdings
      .filter((holding) => holding.identifier === identifier)
      .map((holding) => ({
        key: holding.key,
        identifier,
        person: holding.person,
        kind: holding.kind,
        start: parseMs(holding.start),
        end: parseMs(holding.end),
        stated: parseMs(holding.stated),
        document: holding.document,
        active: holding.active,
        colour: 0,
      }))
      .sort((a, b) => (a.start ?? -Infinity) - (b.start ?? -Infinity) || a.person.localeCompare(b.person))
    for (const bar of bars) {
      bar.colour = colourOf(bar.person)
      if (bar.start === null && bar.end === null) undated.push(bar)
      else allBars.push(bar)
    }
    const laneEvents = events.filter((event) => event.from === identifier || event.to === identifier)
    const calls = laneEvents.some((event) => event.type === 'call')
    const transfers = laneEvents.some((event) => event.type === 'transfer')
    return {
      identifier,
      bars: bars.filter((bar) => bar.start !== null || bar.end !== null),
      events: laneEvents,
      conflicts: conflicts.filter((c) => c.identifier === identifier),
      kind: calls && !transfers ? 'phone number' : transfers && !calls ? 'bank account' : 'identifier',
      holders: [...new Set(bars.map((bar) => bar.person))],
    }
  })

  return { lanes, bars: allBars, events, undated }
}

function computeDomain(model: Model, zoom: Zoom): [number, number] | null {
  const points: number[] = []
  const push = (value: number | null) => {
    if (value !== null && Number.isFinite(value)) points.push(value)
  }
  if (zoom === 'events') {
    model.events.forEach((event) => push(event.at))
    model.bars
      .filter((bar) => bar.kind === 'claim')
      .forEach((bar) => {
        push(bar.start)
        push(bar.end)
      })
  }
  if (zoom === 'all' || points.length === 0) {
    model.bars.forEach((bar) => {
      push(bar.start)
      push(bar.end)
    })
    model.events.forEach((event) => push(event.at))
  }
  if (points.length === 0) return null
  let lo = Math.min(...points)
  let hi = Math.max(...points)
  const minimum = 7 * DAY_MS
  if (hi - lo < minimum) {
    const middle = (lo + hi) / 2
    lo = middle - minimum / 2
    hi = middle + minimum / 2
  }
  const pad = (hi - lo) * 0.04
  return [lo - pad, hi + pad]
}

// --- Axis ----------------------------------------------------------------------------

interface Tick {
  t: number
  label: string | null
  major: boolean
}

function istParts(t: number) {
  const shifted = new Date(t + IST_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
  }
}

function istMidnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d) - IST_OFFSET_MS
}

function monthTicks(lo: number, hi: number, label: (t: number, k: number) => string | null, major = true): Tick[] {
  const start = istParts(lo)
  const out: Tick[] = []
  for (let k = 0; k < 600; k += 1) {
    const t = istMidnight(start.y, start.m + k, 1)
    if (t > hi) break
    if (t >= lo) out.push({ t, label: label(t, k), major })
  }
  return out
}

function makeTicks(lo: number, hi: number, plotWidth: number): Tick[] {
  const days = (hi - lo) / DAY_MS
  const perDay = plotWidth / days
  const start = istParts(lo)
  let firstDay = istMidnight(start.y, start.m, start.d)
  if (firstDay < lo) firstDay += DAY_MS

  if (days <= 24) {
    const every = Math.max(1, Math.ceil(48 / perDay))
    const out: Tick[] = []
    for (let t = firstDay, k = 0; t <= hi; t += DAY_MS, k += 1) {
      out.push({ t, label: k % every === 0 ? formatDayMonth(t) : null, major: k % every === 0 })
    }
    return out
  }

  if (days <= 160) {
    const out: Tick[] = []
    let monday = firstDay
    while (istParts(monday).dow !== 1) monday += DAY_MS
    const labelWeeks = perDay * 7 >= 50
    for (let t = monday; t <= hi; t += 7 * DAY_MS) {
      out.push({ t, label: labelWeeks ? formatDayMonth(t) : null, major: false })
    }
    return [...out, ...monthTicks(lo, hi, (t) => formatMonthYear(t))]
  }

  const perMonth = perDay * 30.4
  if (perMonth >= 40) {
    return monthTicks(lo, hi, (t, k) => {
      const p = istParts(t)
      return p.m === 0 || k === 0 ? formatMonthYear(t) : formatMonthYear(t).split(' ')[0]
    })
  }
  if (perMonth >= 13) {
    return monthTicks(lo, hi, (t) => (istParts(t).m % 3 === 0 ? formatMonthYear(t) : null)).map((tick) => ({
      ...tick,
      major: tick.label !== null,
    }))
  }
  return monthTicks(lo, hi, (t) => (istParts(t).m === 0 ? String(istParts(t).y) : null)).map((tick) => ({
    ...tick,
    major: tick.label !== null,
  }))
}

/** Drops labels that would print over their neighbours, majors kept first. */
function spaceLabels(ticks: (Tick & { x: number })[], gap = 46): (Tick & { x: number })[] {
  const ordered = [...ticks].sort((a, b) => Number(b.major) - Number(a.major) || a.t - b.t)
  const kept: number[] = []
  const labelled = new Set<Tick & { x: number }>()
  for (const tick of ordered) {
    if (!tick.label) continue
    if (kept.every((x) => Math.abs(x - tick.x) >= gap)) {
      kept.push(tick.x)
      labelled.add(tick)
    }
  }
  return ticks.map((tick) => (labelled.has(tick) ? tick : { ...tick, label: null }))
}

// --- Layout ---------------------------------------------------------------------------

export interface PlacedBar extends BarModel {
  x0: number
  x1: number
  y: number
  clippedLeft: boolean
  clippedRight: boolean
}

export interface PlacedGroup {
  id: string
  lane: number
  identifier: string
  type: 'call' | 'transfer'
  at: number
  x: number
  events: EventModel[]
  ambiguous: boolean
  unattributed: boolean
  stripTop: number
  laneBottom: number
  /** Print the "×3" count; off when the next mark on the lane is too close. */
  showCount: boolean
}

export interface PlacedLane {
  model: LaneModel
  top: number
  height: number
  stripTop: number
  bars: PlacedBar[]
  bands: { x0: number; x1: number; label: string; labelX: number }[]
  outside: number
}

/** Rough advance of the condensed face at the sizes the chart uses. */
const textWidth = (text: string, perChar = 5.6) => text.length * perChar

export interface Layout {
  width: number
  height: number
  plotLeft: number
  plotRight: number
  lo: number
  hi: number
  ticks: (Tick & { x: number })[]
  lanes: PlacedLane[]
  groups: PlacedGroup[]
}

export function layoutTimeline(model: Model, width: number, zoom: Zoom): Layout | null {
  const domain = computeDomain(model, zoom)
  if (!domain) return null
  const [lo, hi] = domain
  const plotLeft = width < 640 ? 100 : 136
  const plotRight = width - RIGHT
  const plotWidth = Math.max(40, plotRight - plotLeft)
  const x = (t: number) => plotLeft + ((t - lo) / (hi - lo)) * plotWidth
  const clampX = (value: number) => Math.min(plotRight, Math.max(plotLeft, value))

  const lanes: PlacedLane[] = []
  const groups: PlacedGroup[] = []
  let top = AXIS

  model.lanes.forEach((lane, laneIndex) => {
    const hasNote = lane.conflicts.length > 0
    const stripTop = top + LANE_PAD + (hasNote ? NOTE : 0)
    const barsTop = stripTop + STRIP

    // Interval partitioning on pixel extents: overlapping holdings stack.
    const rowsEnd: number[] = []
    const bars: PlacedBar[] = []
    let outside = 0
    for (const bar of lane.bars) {
      const startsAfter = bar.start !== null && bar.start > hi
      const endsBefore = bar.end !== null && bar.end < lo
      if (startsAfter || endsBefore) {
        outside += 1
        continue
      }
      const clippedLeft = bar.start === null || bar.start < lo
      const clippedRight = bar.end === null || bar.end > hi
      const x0 = clippedLeft ? plotLeft : clampX(x(bar.start ?? lo))
      const x1 = Math.max(x0 + 3, clippedRight ? plotRight : clampX(x(bar.end ?? hi)))
      let row = rowsEnd.findIndex((end) => end + 3 <= x0)
      if (row === -1) {
        row = rowsEnd.length
        rowsEnd.push(x1)
      } else rowsEnd[row] = x1
      bars.push({ ...bar, x0, x1, y: barsTop + row * (BAR + BAR_GAP), clippedLeft, clippedRight })
    }
    const rows = Math.max(1, rowsEnd.length)
    const laneBottom = barsTop + rows * (BAR + BAR_GAP) - BAR_GAP + LANE_PAD
    const height = laneBottom - top

    const bands = lane.conflicts.map((conflict) => {
      const x0 = clampX(x(conflict.from)) - 4
      const x1 = clampX(x(conflict.to)) + 4
      const label = `${plural(conflict.events, 'event')} read as ${conflict.holders.join(' or ')} · ${formatRange(conflict.from, conflict.to)}`
      // Starts at the band, but slides left rather than run off the plot.
      const labelX = Math.max(plotLeft + 4, Math.min(x0 + 4, plotRight - 4 - textWidth(label, 5.3)))
      return { x0, x1, label, labelX }
    })

    // One mark per day and type, so a burst of calls reads as a burst.
    const byDay = new Map<string, EventModel[]>()
    for (const event of lane.events) {
      const id = `${istDayKey(event.at)}|${event.type}`
      const list = byDay.get(id) ?? []
      list.push(event)
      byDay.set(id, list)
    }
    const laneGroups: PlacedGroup[] = []
    for (const [id, list] of byDay) {
      const at = list[0].at
      if (at < lo || at > hi) continue
      const sideNames = (event: EventModel) =>
        new Set(
          event.readings.map((reading) =>
            event.from === lane.identifier ? reading.source : reading.target,
          ),
        )
      laneGroups.push({
        id: `${laneIndex}|${id}`,
        lane: laneIndex,
        identifier: lane.identifier,
        type: list[0].type,
        at,
        x: x(at),
        events: list,
        ambiguous: list.some((event) => sideNames(event).size > 1),
        unattributed: list.every((event) => sideNames(event).size === 0),
        stripTop,
        laneBottom,
        showCount: false,
      })
    }
    laneGroups.sort((a, b) => a.x - b.x)
    laneGroups.forEach((group, index) => {
      const next = laneGroups[index + 1]
      group.showCount =
        group.events.length > 1 && (!next || next.x - group.x >= 18) && group.x + 18 <= plotRight + RIGHT
    })
    groups.push(...laneGroups)

    lanes.push({ model: lane, top, height, stripTop, bars, bands, outside })
    top = laneBottom + LANE_GAP
  })

  groups.sort((a, b) => a.at - b.at || a.lane - b.lane)
  // A label that would run off the right edge is dropped; its gridline stays.
  const ticks = spaceLabels(makeTicks(lo, hi, plotWidth).map((tick) => ({ ...tick, x: x(tick.t) }))).map((tick) =>
    tick.label && tick.x + 3 + textWidth(tick.label, 6) > width - 2 ? { ...tick, label: null } : tick,
  )
  return { width, height: top + 4, plotLeft, plotRight, lo, hi, ticks, lanes, groups }
}

// --- Text -------------------------------------------------------------------------------

export function barLabel(bar: PlacedBar, claimWindow: number): string {
  const parts = [bar.person, bar.kind]
  if (bar.kind === 'claim' && bar.stated !== null) {
    parts.push(`stated ${formatDayMonth(bar.stated)}, ±${claimWindow} days assumed`)
  } else if (bar.clippedLeft && bar.start !== null) {
    parts.push(`since ${formatDate(bar.start)}`)
  } else if (bar.start === null) {
    parts.push('start not stated')
  }
  if (!bar.active) parts.unshift('not counted')
  return parts.join(' · ')
}

/** Holding ends arrive as the midnight after the last day held (a record
 *  "to 31 Mar" ends at 1 Apr 00:00 IST), so a printed range steps back into
 *  the last day itself. Bars are still drawn to the exclusive end. */
export function lastDay(end: number | null): number | null {
  return end === null ? null : end - 1
}

export function barTitle(bar: BarModel, claimWindow: number): string {
  const head = `${bar.person} — ${bar.kind} (${bar.document ?? 'original not named'})`
  if (bar.kind === 'claim') {
    return `${head}\nStated for ${formatDate(bar.stated)}; drawn ±${claimWindow} days (${formatRange(bar.start, lastDay(bar.end))}) as the reach the analysis assumes for a claim.${bar.active ? '' : '\nNot counted under the current decisions.'}`
  }
  const span =
    bar.end === null ? `from ${formatDate(bar.start)}, open-ended` : formatRange(bar.start, lastDay(bar.end))
  return `${head}\nHolds ${bar.identifier} ${span}.${bar.active ? '' : '\nNot counted under the current decisions.'}`
}

export function eventLine(event: EventModel): string {
  const what =
    event.type === 'call'
      ? `call ${event.from} → ${event.to}`
      : `transfer ${event.from} → ${event.to}${event.amount !== null ? `, ${formatAmount(event.amount)}` : ''}`
  return `${formatDateTime(event.at)} · ${what} · read as ${readingsText(event.readings)} · ${event.document ?? 'source not named'}`
}

export function truncate(text: string, pixels: number): string | null {
  const max = Math.floor(pixels / CHAR)
  if (max < 5) return null
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
