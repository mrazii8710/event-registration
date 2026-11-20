import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeRow } from '../utils/prereg'
import { CheckCircle2, ChevronDown, Phone, Search, UserPlus, X } from 'lucide-react'

const DEBOUNCE_MS = 300

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function ResultCard({ row, prereg, busy, onMark }) {
  const [open, setOpen] = useState(false)
  const { title, phones, details, all } = describeRow(row.data, prereg)
  const attended = !!row.attended_at

  return (
    <div
      className={`rounded-xl border p-3.5 flex flex-col gap-2.5 animate-fade-up ${
        attended
          ? 'border-ink-100 dark:border-ink-700 bg-paper dark:bg-ink-900'
          : 'border-marigold-500/40 dark:border-marigold-400/40 bg-cream dark:bg-ink-800'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display font-semibold text-lg leading-tight text-ink-900 dark:text-white">{title}</div>
          {details.length > 0 && (
            <div className="text-sm text-ink-500 dark:text-ink-400 mt-0.5 truncate">
              {details
                .slice(0, 3)
                .map((d) => d.value)
                .join(' · ')}
            </div>
          )}
        </div>
        {attended ? (
          <span className="shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-ink-100 dark:bg-ink-700 text-ink-600 dark:text-ink-300">
            <CheckCircle2 size={13} /> Checked in
          </span>
        ) : null}
      </div>

      {phones.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-700 dark:text-ink-200">
          {phones.map((p) => (
            <span key={p.label} className="flex items-center gap-1" title={p.label}>
              <Phone size={12} className="text-ink-400" /> {p.value}
            </span>
          ))}
        </div>
      )}

      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm border-t border-ink-100 dark:border-ink-700 pt-2">
          {all.map((d) => (
            <div key={d.label} className="contents">
              <dt className="text-ink-500 dark:text-ink-400">{d.label}</dt>
              <dd className="text-ink-900 dark:text-white break-words">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex items-center gap-2">
        {attended ? (
          <p className="flex-1 text-sm text-ink-600 dark:text-ink-300">
            Already checked in at {timeOf(row.attended_at)}, Desk {row.attended_desk}
            {row.attended_operator ? ` (${row.attended_operator})` : ''}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onMark(row)}
            disabled={busy}
            className="flex-1 py-3 rounded-xl bg-marigold-500 dark:bg-marigold-400 text-white dark:text-ink-950 font-display font-semibold text-base hover:opacity-90 active:scale-[0.99] transition disabled:opacity-50"
          >
            {busy ? 'Marking…' : 'Mark attendance'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 flex items-center gap-1 px-3 py-3 rounded-xl text-sm text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-700 transition"
        >
          Details <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  )
}

/**
 * First step at the desk when a pre-registered list is loaded:
 * search by mobile or name → mark attendance, or fall through to the form.
 */
export default function CheckInLookup({ sessionToken, prereg, isOnline, onMarked, onRegisterNew, onSessionExpired, showToast }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null) // { mode, total, results, too_short }
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const inputRef = useRef(null)
  const seq = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function runSearch(q) {
    const mySeq = ++seq.current
    if (q.trim().length < 2) {
      setResult(null)
      setSearching(false)
      setSearchError('')
      return
    }
    setSearching(true)
    const { data, error } = await supabase.rpc('desk_search_preregistrations', {
      p_session_token: sessionToken,
      p_query: q,
    })
    if (mySeq !== seq.current) return // a newer search is on its way
    setSearching(false)
    if (error) {
      if ((error.message || '').includes('invalid_session')) return onSessionExpired()
      setSearchError(navigator.onLine ? 'Search failed. Try again.' : "You're offline, so the list can't be searched.")
      setResult(null)
      return
    }
    setSearchError('')
    setResult(data)
  }

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  function clear() {
    seq.current++
    setQuery('')
    setResult(null)
    setSearchError('')
    inputRef.current?.focus()
  }

  async function handleMark(row) {
    setBusyId(row.id)
    const { data, error } = await supabase.rpc('desk_mark_attendance', {
      p_session_token: sessionToken,
      p_prereg_id: row.id,
    })
    setBusyId(null)
    const name = describeRow(row.data, prereg).title
    if (error) {
      if ((error.message || '').includes('invalid_session')) return onSessionExpired()
      showToast(navigator.onLine ? 'Could not mark attendance. Try again.' : "You're offline. Try again when connected.", 'error')
      return
    }
    if (data.status === 'already') {
      showToast(`${name} was already checked in at Desk ${data.desk_number}`, 'error')
      runSearch(query)
      return
    }
    onMarked({ id: row.id, name })
    clear()
  }

  const results = result?.results || []
  const isPhone = result?.mode === 'phone'
  const noMatch = result && !result.too_short && results.length === 0

  return (
    <div className="w-full max-w-lg flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkin-search" className="text-sm font-medium text-ink-700 dark:text-ink-100">
          Mobile number or name
        </label>
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          <input
            id="checkin-search"
            ref={inputRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch(query)
              } else if (e.key === 'Escape') {
                clear()
              }
            }}
            placeholder="e.g. 0532377647 or Aisha"
            className="w-full text-lg pl-11 pr-11 py-3.5 rounded-xl border border-ink-100 dark:border-ink-700 bg-cream dark:bg-ink-800 text-ink-900 dark:text-white placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-marigold-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-700"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <p className="text-xs text-ink-500 dark:text-ink-400 min-h-[1rem]">
          {searching
            ? 'Searching…'
            : result?.too_short
              ? 'Type at least 4 digits of the number.'
              : result && results.length > 0
                ? `${result.total} match${result.total === 1 ? '' : 'es'}${result.total > results.length ? `, showing ${results.length}. Type more to narrow down` : ''}`
                : `Searches ${prereg.total} pre-registered people. Any format works: 05…, 9665…, +966 5…`}
        </p>
      </div>

      {!isOnline && (
        <div className="px-4 py-3 rounded-lg bg-marigold-500/15 text-marigold-700 dark:text-marigold-400 text-sm">
          {"Offline: the list can't be searched right now. You can still register people with the form; they'll sync later."}
        </div>
      )}
      {searchError && isOnline && (
        <div className="px-4 py-3 rounded-lg bg-flare-500/10 text-flare-600 dark:text-flare-400 text-sm">{searchError}</div>
      )}

      {results.map((row) => (
        <ResultCard key={row.id} row={row} prereg={prereg} busy={busyId === row.id} onMark={handleMark} />
      ))}

      {noMatch && (
        <div className="rounded-xl border border-dashed border-ink-200 dark:border-ink-600 p-4 text-center flex flex-col gap-1 animate-fade-up">
          <span className="font-display font-semibold text-ink-900 dark:text-white">Not on the list</span>
          <span className="text-sm text-ink-500 dark:text-ink-400">
            {isPhone ? 'No one with that number. Try their name, or register them as new.' : 'No one with that name. Try their mobile number, or register them as new.'}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => onRegisterNew(query.trim())}
        className={`flex items-center justify-center gap-2 py-3 rounded-xl font-display font-semibold transition active:scale-[0.99] ${
          noMatch || !isOnline
            ? 'bg-marigold-500 dark:bg-marigold-400 text-white dark:text-ink-950 hover:opacity-90 text-lg'
            : 'border border-ink-200 dark:border-ink-600 text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800'
        }`}
      >
        <UserPlus size={18} /> Register as new
      </button>
    </div>
  )
}
