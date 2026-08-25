import {
  Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

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
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="netintel-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7aa2f7" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#7aa2f7" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#2a2f45" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: '#8b93a7', fontSize: 11 }} tickLine={false} />
        <YAxis tick={{ fill: '#8b93a7', fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: '#1a1e2e',
            border: '1px solid #2a2f45',
            borderRadius: 6,
            color: '#c8d0e0',
          }}
        />
        {anomalyStart && anomalyEnd && (
          <ReferenceArea x1={anomalyStart} x2={anomalyEnd} fill="#f7768e" fillOpacity={0.15} />
        )}
        <Area
          type="monotone"
          dataKey="value"
          name={label}
          stroke="#7aa2f7"
          strokeWidth={2}
          fill="url(#netintel-area)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
