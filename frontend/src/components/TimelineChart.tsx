import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { readThemeColor, useResolvedTheme } from '../lib/theme'

/** Recharts renders to SVG with inline props rather than classes, so the chart
 *  palette lives in index.css as plain hex under --chart-* and is read out of
 *  the cascade on render, which is what lets it follow the theme. */
function useChartPalette() {
  // Subscribing to the theme is what re-runs this on a toggle.
  useResolvedTheme()
  return {
    series: readThemeColor('--chart-series', '#2D5F8A'),
    rule: readThemeColor('--chart-rule', '#DCD3C2'),
    axis: readThemeColor('--chart-axis', '#6B6154'),
    paper: readThemeColor('--chart-paper', '#F4F1E9'),
    ink: readThemeColor('--chart-ink', '#332C26'),
    anomaly: readThemeColor('--chart-anomaly', '#9B2020'),
  }
}

export interface TimelinePoint {
  date: string
  value: number
}

/** Time series with the anomalous window shaded, so the flagged period is
 *  legible without reading the axis. */
export default function TimelineChart({
  data,
  anomalyStart,
  anomalyEnd,
  label = 'Value',
}: {
  data: TimelinePoint[]
  anomalyStart?: string
  anomalyEnd?: string
  label?: string
}) {
  const c = useChartPalette()

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="netintel-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.series} stopOpacity={0.32} />
            <stop offset="100%" stopColor={c.series} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.rule} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: c.axis, fontSize: 12 }}
          tickLine={false}
          stroke={c.rule}
        />
        <YAxis
          tick={{ fill: c.axis, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ stroke: c.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
          contentStyle={{
            background: c.paper,
            border: `1px solid ${c.rule}`,
            borderRadius: 8,
            color: c.ink,
            fontSize: 12,
          }}
        />
        {anomalyStart && anomalyEnd && (
          <ReferenceArea
            x1={anomalyStart}
            x2={anomalyEnd}
            fill={c.anomaly}
            fillOpacity={0.1}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          name={label}
          stroke={c.series}
          strokeWidth={2}
          fill="url(#netintel-area)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
