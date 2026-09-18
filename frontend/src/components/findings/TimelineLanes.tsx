import { useId, useMemo, useState, type KeyboardEvent } from 'react'

import type { Contrary } from '../../api/investigation'
import { formatAmount, formatDate, formatDateTime, formatRange, plural } from '../../lib/format'
import { useElementWidth } from '../../lib/useElementWidth'
import { Segmented } from '../Instrument'
import { useFindingTables } from './FindingTables'
import { readingsText } from './model'
import {
  AXIS,
  BAR,
  FADE,
  NOTE,
  PALETTE,
  STRIP,
  barLabel,
  barTitle,
  buildModel,
  eventLine,
  lastDay,
  layoutTimeline,
  truncate,
  type Model,
  type PlacedBar,
  type PlacedGroup,
  type Timeline,
  type Zoom,
} from './timelineLayout'

/** Who held each number or account, and when the calls and transfers
 *  happened, on one time axis.
 *
 *  One lane per identifier. A record of who held it is a solid bar; a claim
 *  is hatched and drawn as the window the analysis lets it reach (the stated
 *  date plus or minus the claim window), because a claim does not say when a
 *  holding began or ended. Calls and transfers are ticks above the bars, one
 *  per day and type, so dozens of events stay legible. When the same event
 *  can be read as more than one person, the tick and a band say so in the
 *  signal colour and in words.
 *
 *  Plain SVG laid out at the real pixel width; colours come from the theme's
 *  custom properties, so the chart follows paper and darkroom without
 *  re-reading anything at runtime.
 */

// --- Component --------------------------------------------------------------------------

export default function TimelineLanes({ timeline, contrary }: { timeline: Timeline; contrary: Contrary[] }) {
  const { people } = useFindingTables()
  const [zoom, setZoom] = useState<Zoom>('events')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [setBox, width] = useElementWidth<HTMLDivElement>()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const claimWindow = timeline.claim_window_days

  const model = useMemo(() => buildModel(timeline, contrary, people), [timeline, contrary, people])
  const layout = useMemo(() => (width > 0 ? layoutTimeline(model, width, zoom) : null), [model, width, zoom])
  const selected = layout?.groups.find((group) => group.id === selectedId) ?? null

  const summary = `${plural(model.lanes.length, 'identifier')}, ${plural(model.bars.length, 'dated holding')}, ${plural(
    model.events.filter((e) => e.type === 'call').length,
    'call',
  )} and ${plural(model.events.filter((e) => e.type === 'transfer').length, 'transfer')}${
    model.events.length ? `, ${formatRange(model.events[0].at, model.events[model.events.length - 1].at)}` : ''
  }.`

  function step(event: KeyboardEvent<HTMLDivElement>) {
    if (!layout || layout.groups.length === 0) return
    const index = layout.groups.findIndex((group) => group.id === selectedId)
    let next = index
    if (event.key === 'ArrowRight') next = index < 0 ? 0 : Math.min(layout.groups.length - 1, index + 1)
    else if (event.key === 'ArrowLeft') next = index < 0 ? 0 : Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = layout.groups.length - 1
    else if (event.key === 'Escape') {
      setSelectedId(null)
      return
    } else return
    event.preventDefault()
    setSelectedId(layout.groups[next].id)
  }

  if (model.lanes.length === 0) {
    return (
      <p className="border-l-2 border-ink-800 px-3 py-2 text-[12.5px] text-ink-500">
        No dated holdings, calls or transfers are attached to this finding.
      </p>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimelineLegend claimWindow={claimWindow} />
        <div className="flex items-center gap-2">
          <span className="legend">Window</span>
          <Segmented
            options={[
              { value: 'events' as const, label: 'Around the events' },
              { value: 'all' as const, label: 'Full record' },
            ]}
            value={zoom}
            onChange={(next) => {
              setZoom(next)
              setSelectedId(null)
            }}
          />
        </div>
      </div>

      <div
        ref={setBox}
        tabIndex={0}
        role="group"
        aria-label={`Holdings and events timeline. ${summary} Use the left and right arrow keys to step through the events.`}
        onKeyDown={step}
        className="mt-3 border hairline bg-ink-1000"
      >
        {layout && (
          <svg
            width={layout.width}
            height={layout.height}
            role="img"
            aria-labelledby={`${uid}-title ${uid}-desc`}
            className="block select-none"
          >
            <title id={`${uid}-title`}>Holdings and events timeline</title>
            <desc id={`${uid}-desc`}>{summary}</desc>
            <defs>
              {Array.from({ length: PALETTE }, (_, i) => (
                <pattern
                  key={i}
                  id={`${uid}-hatch-${i + 1}`}
                  patternUnits="userSpaceOnUse"
                  width="5"
                  height="5"
                  patternTransform="rotate(45)"
                >
                  <rect width="1.6" height="5" style={{ fill: `var(--graph-c${i + 1})` }} />
                </pattern>
              ))}
              <linearGradient
                id={`${uid}-fade-r-grad`}
                gradientUnits="userSpaceOnUse"
                x1={layout.plotRight - FADE}
                x2={layout.plotRight}
                y1="0"
                y2="0"
              >
                <stop offset="0" stopColor="white" stopOpacity="1" />
                <stop offset="1" stopColor="white" stopOpacity="0" />
              </linearGradient>
              <linearGradient
                id={`${uid}-fade-l-grad`}
                gradientUnits="userSpaceOnUse"
                x1={layout.plotLeft}
                x2={layout.plotLeft + FADE}
                y1="0"
                y2="0"
              >
                <stop offset="0" stopColor="white" stopOpacity="0" />
                <stop offset="1" stopColor="white" stopOpacity="1" />
              </linearGradient>
              <mask id={`${uid}-fade-r`} maskUnits="userSpaceOnUse" x="0" y="0" width={layout.width} height={layout.height}>
                <rect x="0" y="0" width={layout.width} height={layout.height} fill={`url(#${uid}-fade-r-grad)`} />
              </mask>
              <mask id={`${uid}-fade-l`} maskUnits="userSpaceOnUse" x="0" y="0" width={layout.width} height={layout.height}>
                <rect x="0" y="0" width={layout.width} height={layout.height} fill={`url(#${uid}-fade-l-grad)`} />
              </mask>
              <clipPath id={`${uid}-plot`}>
                <rect x={layout.plotLeft} y="0" width={layout.plotRight - layout.plotLeft} height={layout.height} />
              </clipPath>
            </defs>

            {/* Lane grounds first, so gridlines and marks sit on them. */}
            {layout.lanes.map((lane, index) => (
              <rect
                key={lane.model.identifier}
                x="0"
                y={lane.top}
                width={layout.width}
                height={lane.height}
                style={{ fill: index % 2 === 0 ? 'var(--tint)' : 'transparent' }}
              />
            ))}

            {/* Axis and gridlines. */}
            {layout.ticks.map((tick) => (
              <g key={`${tick.t}-${tick.major}`}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={AXIS - 6}
                  y2={layout.height}
                  style={{ stroke: tick.major ? 'var(--tick-color)' : 'var(--grid-line)' }}
                  strokeWidth="1"
                />
                {tick.label && (
                  <text
                    x={tick.x + 3}
                    y={AXIS - 11}
                    style={{ fill: 'var(--color-ink-500)', fontFamily: 'var(--font-cond)' }}
                    fontSize="10.5"
                    fontWeight="600"
                    letterSpacing="0.04em"
                  >
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            <line
              x1={layout.plotLeft}
              x2={layout.plotRight}
              y1={AXIS - 6}
              y2={AXIS - 6}
              style={{ stroke: 'var(--rule-color)' }}
            />

            {layout.lanes.map((lane) => (
              <g key={lane.model.identifier}>
                <text
                  x="10"
                  y={lane.top + 17}
                  style={{ fill: 'var(--color-ink-100)', fontFamily: 'var(--font-mono)' }}
                  fontSize="11.5"
                >
                  {lane.model.identifier}
                </text>
                <text
                  x="10"
                  y={lane.top + 31}
                  style={{ fill: 'var(--color-ink-500)', fontFamily: 'var(--font-cond)' }}
                  fontSize="9.5"
                  fontWeight="600"
                  letterSpacing="0.1em"
                >
                  {lane.model.kind.toUpperCase()}
                </text>
                <text
                  x="10"
                  y={lane.top + 44}
                  style={{ fill: 'var(--color-ink-500)', fontFamily: 'var(--font-sans)' }}
                  fontSize="10"
                >
                  {lane.model.holders.length === 0
                    ? 'no holder on file'
                    : plural(lane.model.holders.length, 'named holder')}
                </text>

                <g clipPath={`url(#${uid}-plot)`}>
                  {lane.bands.map((band) => (
                    <g key={`${band.x0}-${band.x1}`}>
                      <rect
                        x={band.x0}
                        y={lane.stripTop - NOTE + 2}
                        width={Math.max(2, band.x1 - band.x0)}
                        height={lane.top + lane.height - (lane.stripTop - NOTE + 2) - 3}
                        style={{ fill: 'var(--select-bg)', stroke: 'var(--color-signal)' }}
                        fillOpacity="0.45"
                        strokeOpacity="0.7"
                        strokeDasharray="3 2"
                      />
                      <text
                        x={band.labelX}
                        y={lane.stripTop - 3}
                        style={{ fill: 'var(--color-signal)', fontFamily: 'var(--font-cond)' }}
                        fontSize="10"
                        fontWeight="600"
                      >
                        {band.label}
                      </text>
                    </g>
                  ))}

                  {lane.bars.map((bar) => (
                    <TimelineBar key={bar.key} bar={bar} uid={uid} claimWindow={claimWindow} />
                  ))}
                </g>
              </g>
            ))}

            {layout.groups.map((group) => (
              <EventMark
                key={group.id}
                group={group}
                selected={group.id === selectedId}
                onSelect={() => setSelectedId(group.id === selectedId ? null : group.id)}
              />
            ))}
          </svg>
        )}
        {!layout && width > 0 && (
          <p className="px-3 py-4 text-[12.5px] text-ink-500">Nothing on this finding carries a date to place.</p>
        )}
      </div>

      <div aria-live="polite" className="mt-2 min-h-[2.5rem] border-l-2 border-ink-800 px-3 py-1.5">
        {selected ? (
          <div>
            <p className="text-[12.5px] text-ink-200">
              {formatDate(selected.at)} · {plural(selected.events.length, selected.type === 'call' ? 'call' : 'transfer')} on{' '}
              <span className="readout">{selected.identifier}</span>
              {selected.ambiguous && <span className="ml-2 text-signal">read as more than one person</span>}
            </p>
            <ul className="mt-1 space-y-0.5">
              {selected.events.map((event) => (
                <li key={event.key} className="font-mono text-[11px] leading-relaxed text-ink-400">
                  {eventLine(event)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[12px] text-ink-500">
            Select a tick, or focus the chart and use the arrow keys, to read each event and who it can be
            attributed to.
          </p>
        )}
      </div>

      {layout && layout.lanes.some((lane) => lane.outside > 0) && (
        <p className="mt-2 text-[11.5px] text-ink-500">
          {plural(
            layout.lanes.reduce((sum, lane) => sum + lane.outside, 0),
            'holding lies',
            'holdings lie',
          )}{' '}
          wholly outside this window. Switch to the full record to see them.
        </p>
      )}
      {model.undated.length > 0 && (
        <p className="mt-2 text-[11.5px] text-ink-500">
          {plural(model.undated.length, 'holding has', 'holdings have')} no date and cannot be placed:{' '}
          {model.undated.map((bar) => `${bar.person} (${bar.identifier}, ${bar.kind})`).join('; ')}.
        </p>
      )}

      <TimelineTable model={model} claimWindow={claimWindow} />
    </div>
  )
}

function TimelineBar({ bar, uid, claimWindow }: { bar: PlacedBar; uid: string; claimWindow: number }) {
  const colour = `var(--graph-c${bar.colour})`
  const record = bar.kind === 'record'
  const width = Math.max(3, bar.x1 - bar.x0)
  // Open edges carry no outline: the bar runs on past what is drawn.
  const outline = [
    `M${bar.x0 + width},${bar.y}`,
    `H${bar.x0}`,
    bar.clippedLeft ? `M${bar.x0},${bar.y + BAR}` : `V${bar.y + BAR}`,
    `H${bar.x0 + width}`,
    bar.clippedRight ? '' : `V${bar.y}`,
  ].join(' ')

  let shape = (
    <g opacity={bar.active ? 1 : 0.35}>
      <rect
        x={bar.x0}
        y={bar.y}
        width={width}
        height={BAR}
        style={{ fill: record ? colour : `url(#${uid}-hatch-${bar.colour})` }}
        fillOpacity={record ? 0.24 : 0.85}
      />
      <path
        d={outline}
        fill="none"
        style={{ stroke: colour }}
        strokeWidth="1.25"
        strokeDasharray={record ? undefined : '4 2'}
      />
      {bar.kind === 'claim' && bar.stated !== null && (
        <StatedMark bar={bar} colour={colour} />
      )}
    </g>
  )
  if (bar.clippedRight) shape = <g mask={`url(#${uid}-fade-r)`}>{shape}</g>
  if (bar.clippedLeft) shape = <g mask={`url(#${uid}-fade-l)`}>{shape}</g>

  const label = truncate(barLabel(bar, claimWindow), width - (bar.clippedLeft ? 10 : 8) - (bar.clippedRight ? FADE / 2 : 0))

  return (
    <g>
      <title>{barTitle(bar, claimWindow)}</title>
      {shape}
      {label && (
        <text
          x={bar.x0 + (bar.clippedLeft ? 8 : 6)}
          y={bar.y + BAR / 2 + 3.5}
          style={{
            fill: 'var(--color-ink-100)',
            fontFamily: 'var(--font-cond)',
            stroke: 'var(--color-ink-1000)',
            paintOrder: 'stroke',
          }}
          strokeWidth="3"
          strokeLinejoin="round"
          fontSize="10.5"
          fontWeight="600"
        >
          {label}
        </text>
      )}
    </g>
  )
}

/** The date a claim actually states, inside the window drawn around it. */
function StatedMark({ bar, colour }: { bar: PlacedBar; colour: string }) {
  if (bar.stated === null || bar.start === null || bar.end === null) return null
  const ratio = (bar.stated - bar.start) / (bar.end - bar.start)
  const x = bar.x0 + ratio * (bar.x1 - bar.x0)
  return <line x1={x} x2={x} y1={bar.y - 2} y2={bar.y + BAR + 2} style={{ stroke: colour }} strokeWidth="2" />
}

function EventMark({
  group,
  selected,
  onSelect,
}: {
  group: PlacedGroup
  selected: boolean
  onSelect: () => void
}) {
  const colour = group.ambiguous ? 'var(--color-signal)' : 'var(--color-ink-200)'
  const bottom = group.stripTop + STRIP - 3
  const middle = group.stripTop + STRIP / 2
  const count = group.events.length
  const title = [
    `${formatDate(group.at)}: ${plural(count, group.type === 'call' ? 'call' : 'transfer')} on ${group.identifier}${
      group.ambiguous ? ' (read as more than one person)' : ''
    }`,
    ...group.events.map(eventLine),
  ].join('\n')

  return (
    <g onClick={onSelect} className="cursor-pointer">
      <title>{title}</title>
      <line
        x1={group.x}
        x2={group.x}
        y1={group.stripTop + STRIP}
        y2={group.laneBottom - 3}
        style={{ stroke: group.ambiguous ? 'var(--color-signal)' : 'var(--tick-color)' }}
        strokeOpacity={group.ambiguous ? 0.5 : 1}
        strokeDasharray="1 3"
      />
      {selected && (
        <rect
          x={group.x - 7}
          y={group.stripTop + 1}
          width="14"
          height={STRIP - 2}
          fill="none"
          style={{ stroke: 'var(--color-signal)' }}
          strokeWidth="1.5"
        />
      )}
      {group.type === 'call' ? (
        <>
          <line
            x1={group.x}
            x2={group.x}
            y1={group.stripTop + 4}
            y2={bottom}
            style={{ stroke: colour }}
            strokeWidth="1.6"
          />
          <circle
            cx={group.x}
            cy={bottom}
            r="2.6"
            style={{ fill: group.unattributed ? 'var(--color-ink-1000)' : colour, stroke: colour }}
            strokeWidth="1.2"
          />
        </>
      ) : (
        <rect
          x={group.x - 3.5}
          y={middle - 3.5}
          width="7"
          height="7"
          transform={`rotate(45 ${group.x} ${middle})`}
          style={{ fill: group.unattributed ? 'var(--color-ink-1000)' : colour, stroke: colour }}
          strokeWidth="1.2"
        />
      )}
      {group.showCount && (
        <text
          x={group.x + 4.5}
          y={group.stripTop + 9}
          style={{ fill: colour, fontFamily: 'var(--font-mono)' }}
          fontSize="9"
        >
          ×{count}
        </text>
      )}
      {/* Generous hit area; the marks themselves are a few pixels wide. */}
      <rect x={group.x - 6} y={group.stripTop} width="12" height={STRIP} fill="transparent" />
    </g>
  )
}

function TimelineLegend({ claimWindow }: { claimWindow: number }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-400">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-6 border border-ink-400 bg-ink-400/25" />
        Record of who held it
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="hatch h-2.5 w-6 border border-dashed border-ink-400 text-ink-400" />
        Claim: stated date ±{claimWindow} days assumed
      </li>
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="10" height="14">
          <line x1="5" x2="5" y1="1" y2="10" style={{ stroke: 'var(--color-ink-200)' }} strokeWidth="1.6" />
          <circle cx="5" cy="10" r="2.6" style={{ fill: 'var(--color-ink-200)' }} />
        </svg>
        Call
      </li>
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="12" height="12">
          <rect x="2.5" y="2.5" width="7" height="7" transform="rotate(45 6 6)" style={{ fill: 'var(--color-ink-200)' }} />
        </svg>
        Transfer
      </li>
      <li className="flex items-center gap-1.5 text-signal">
        <svg aria-hidden="true" width="10" height="14">
          <line x1="5" x2="5" y1="1" y2="10" style={{ stroke: 'var(--color-signal)' }} strokeWidth="1.6" />
          <circle cx="5" cy="10" r="2.6" style={{ fill: 'var(--color-signal)' }} />
        </svg>
        Read as more than one person
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-6 bg-gradient-to-r from-ink-400/40 to-transparent" />
        Fades: open-ended, or runs past the window
      </li>
    </ul>
  )
}

/** The same content as rows, for screen readers and for anyone who would
 *  rather read a table than a chart. */
function TimelineTable({ model, claimWindow }: { model: Model; claimWindow: number }) {
  return (
    <details className="mt-3 border hairline">
      <summary className="cursor-pointer px-3 py-2 font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 hover:text-ink-200">
        Read the timeline as a table
      </summary>
      <div className="relative space-y-4 overflow-x-auto border-t hairline p-3">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <caption className="legend pb-1.5 text-left">Holdings</caption>
          <thead className="text-ink-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Identifier</th>
              <th className="py-1 pr-3 font-normal">Holder</th>
              <th className="py-1 pr-3 font-normal">Kind</th>
              <th className="py-1 pr-3 font-normal">Period</th>
              <th className="py-1 font-normal">Original</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule text-ink-200">
            {model.lanes.flatMap((lane) =>
              lane.bars.map((bar) => (
                <tr key={bar.key}>
                  <td className="readout py-1 pr-3">{bar.identifier}</td>
                  <td className="py-1 pr-3">{bar.person}</td>
                  <td className="py-1 pr-3">{bar.kind === 'record' ? 'Record' : 'Claim'}{bar.active ? '' : ' (not counted)'}</td>
                  <td className="py-1 pr-3">
                    {bar.kind === 'claim'
                      ? `stated ${formatDate(bar.stated)}, ±${claimWindow} days`
                      : bar.end === null
                        ? `from ${formatDate(bar.start)}, open-ended`
                        : formatRange(bar.start, lastDay(bar.end))}
                  </td>
                  <td className="py-1 font-mono text-[11px] text-ink-400">{bar.document ?? 'not named'}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>

        <table className="w-full min-w-[560px] text-left text-[12px]">
          <caption className="legend pb-1.5 text-left">Events · {model.events.length}</caption>
          <thead className="text-ink-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Time</th>
              <th className="py-1 pr-3 font-normal">Event</th>
              <th className="py-1 pr-3 font-normal">Read as</th>
              <th className="py-1 font-normal">Original</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule text-ink-200">
            {model.events.map((event) => (
              <tr key={event.key}>
                <td className="whitespace-nowrap py-1 pr-3">{formatDateTime(event.at)}</td>
                <td className="py-1 pr-3">
                  {event.type === 'call' ? 'Call' : 'Transfer'} <span className="readout">{event.from}</span> →{' '}
                  <span className="readout">{event.to}</span>
                  {event.amount !== null && ` · ${formatAmount(event.amount)}`}
                </td>
                <td className="py-1 pr-3">{readingsText(event.readings)}</td>
                <td className="py-1 font-mono text-[11px] text-ink-400">{event.document ?? 'not named'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
