import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Activity, BarChart3, Clock3, TrendingUp, Users } from 'lucide-react'

const POLL_MS = 15000

function timeAgo(ts) {
  if (!ts) return ''
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.round(secs / 60)}m ago`
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="flex-1 min-w-[120px] bg-cream dark:bg-ink-800 border border-ink-100 dark:border-ink-700 rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-ink-500 dark:text-ink-400 text-xs font-medium">
        <Icon size={13} /> {label}
      </div>
      <span className="font-display font-semibold text-2xl text-ink-900 dark:text-white">{value}</span>
    </div>
  )
}

// Hand-built SVG bar chart for the 24h trend — no charting dependency needed
// for a shape this simple, and it inherits the page's own palette exactly.
function HourlyChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const w = 600
  const h = 140
  const gap = 3
  const barW = data.length ? w / data.length - gap : 0

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none" role="img" aria-label="Registrations in the last 24 hours">
      {data.map((d, i) => {
        const barH = (d.count / max) * (h - 18)
        const x = i * (barW + gap)
        const y = h - 18 - barH
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={Math.max(barW, 1)}
              height={Math.max(barH, d.count > 0 ? 2 : 0)}
              rx={2}
              className="fill-marigold-500 dark:fill-marigold-400"
              opacity={d.count > 0 ? 1 : 0.15}
            >
              <title>{`${d.hour_label} — ${d.count}`}</title>
            </rect>
            {i % 3 === 0 && (
              <text x={x + barW / 2} y={h - 4} textAnchor="middle" fontSize="9" className="fill-ink-400 dark:fill-ink-500">
                {d.hour_label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function BarList({ rows, emptyText }) {
  if (!rows.length) return <p className="text-sm text-ink-500 dark:text-ink-400 py-2">{emptyText}</p>
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 truncate text-ink-600 dark:text-ink-300">{r.label}</span>
          <div className="flex-1 h-5 rounded-full bg-ink-50 dark:bg-ink-900 overflow-hidden">
            <div
              className="h-full rounded-full bg-lagoon-500 dark:bg-lagoon-400 transition-all duration-500"
              style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-display font-semibold text-ink-900 dark:text-white">{r.count}</span>
        </div>
      ))}
    </div>
  )
}

export default function Analytics({ adminCode }) {
  const [data, setData] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [, forceTick] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    async function load() {
      const { data: result, error } = await supabase.rpc('admin_get_analytics', { p_admin_code: adminCode })
      if (!mounted.current) return
      if (!error && result) {
        setData(result)
        setUpdatedAt(Date.now())
      }
    }
    load()
    const interval = setInterval(load, POLL_MS)
    const tickInterval = setInterval(() => forceTick((t) => t + 1), 5000)
    return () => {
      mounted.current = false
      clearInterval(interval)
      clearInterval(tickInterval)
    }
  }, [adminCode])

  if (!data) {
    return <p className="text-sm text-ink-500 dark:text-ink-400 py-6 text-center">Loading insights…</p>
  }

  const deskRows = data.by_desk.map((d) => ({ label: `Desk ${d.desk_number}`, count: d.count }))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-ink-900 dark:text-white">Live Insights</h2>
        <span className="flex items-center gap-1.5 text-xs text-ink-400 dark:text-ink-500">
          <Activity size={12} className="text-marigold-500" /> Updated {timeAgo(updatedAt)}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <StatTile icon={Users} label="Total registrations" value={data.total_registrations} />
        <StatTile icon={TrendingUp} label="Today" value={data.today_count} />
        <StatTile icon={Clock3} label="Last hour" value={data.last_hour_count} />
      </div>

      <section className="bg-cream dark:bg-ink-800 border border-ink-100 dark:border-ink-700 rounded-2xl p-5 flex flex-col gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-display font-semibold text-ink-900 dark:text-white">
          <BarChart3 size={14} /> Last 24 hours
        </h3>
        <HourlyChart data={data.hourly} />
      </section>

      <section className="bg-cream dark:bg-ink-800 border border-ink-100 dark:border-ink-700 rounded-2xl p-5 flex flex-col gap-3">
        <h3 className="text-sm font-display font-semibold text-ink-900 dark:text-white">Desk leaderboard</h3>
        <BarList rows={deskRows} emptyText="No registrations yet." />
      </section>

      {data.select_breakdown.map((q) => (
        <section key={q.key} className="bg-cream dark:bg-ink-800 border border-ink-100 dark:border-ink-700 rounded-2xl p-5 flex flex-col gap-3">
          <h3 className="text-sm font-display font-semibold text-ink-900 dark:text-white">{q.label}</h3>
          <BarList rows={q.options.map((o) => ({ label: o.option, count: o.count }))} emptyText="No answers yet." />
        </section>
      ))}

      <p className="text-xs text-ink-400 dark:text-ink-500 text-center">
        Insights refresh automatically every 15 seconds — not instant, but always current within a few seconds.
      </p>
    </div>
  )
}
