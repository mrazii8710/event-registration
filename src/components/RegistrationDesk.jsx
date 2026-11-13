import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LogOut, Moon, Sun, WifiOff } from 'lucide-react'

const PENDING_QUEUE_KEY = 'event-app-pending-queue'
const HEARTBEAT_MS = 60_000

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}
function saveQueue(queue) {
  localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue))
}

export default function RegistrationDesk({ deskNumber, sessionToken, onLogout, theme, toggleTheme }) {
  const [config, setConfig] = useState(null)
  const [answers, setAnswers] = useState({})
  const [errors, setErrors] = useState({})
  const [dupWarning, setDupWarning] = useState(null)
  const [toast, setToast] = useState(null)
  const [stats, setStats] = useState({ desk_count: 0, total_count: 0 })
  const [pendingCount, setPendingCount] = useState(loadQueue().length)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [submitting, setSubmitting] = useState(false)

  const fieldRefs = useRef({})
  const firstFieldKeyRef = useRef(null)

  const refreshStats = useCallback(async () => {
    const { data } = await supabase.rpc('get_desk_stats', { p_desk_number: deskNumber })
    if (data) setStats(data)
  }, [deskNumber])

  // Load event config once
  useEffect(() => {
    supabase.rpc('get_event_config').then(({ data }) => {
      if (data) {
        setConfig(data)
        if (data.questions?.length) {
          firstFieldKeyRef.current = data.questions[0].key
        }
      }
    })
    refreshStats()
  }, [refreshStats])

  // Auto-focus first field on mount
  useEffect(() => {
    if (config?.questions?.length) {
      const firstKey = config.questions[0].key
      fieldRefs.current[firstKey]?.focus()
    }
  }, [config])

  // Heartbeat every 60s
  useEffect(() => {
    const interval = setInterval(async () => {
      const { error } = await supabase.rpc('heartbeat_desk', { p_session_token: sessionToken })
      if (error) {
        // Desk session expired (no heartbeat for 3+ min, reclaimed) — force re-login
        onLogout(true)
      }
    }, HEARTBEAT_MS)
    return () => clearInterval(interval)
  }, [sessionToken, onLogout])

  // Online/offline tracking + flush queue when back online
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      flushQueue()
    }
    function handleOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    flushQueue() // try on mount too
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function flushQueue() {
    let queue = loadQueue()
    if (queue.length === 0) return
    const remaining = []
    for (const item of queue) {
      const { error } = await supabase.rpc('submit_registration', {
        p_session_token: item.sessionToken,
        p_answers: item.answers,
      })
      if (error) {
        remaining.push(item) // keep trying later; duplicates will just fail silently on retry
      }
    }
    saveQueue(remaining)
    setPendingCount(remaining.length)
    if (remaining.length < queue.length) refreshStats()
  }

  function showToast(message, kind = 'success') {
    setToast({ message, kind })
    setTimeout(() => setToast(null), 2500)
  }

  function updateAnswer(key, value) {
    setAnswers((a) => ({ ...a, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setDupWarning(null)
  }

  async function handleBlurDuplicateCheck(q) {
    if (!q.check_duplicate) return
    const value = answers[q.key]
    if (!value || !value.trim()) return
    const { data } = await supabase.rpc('check_duplicate_value', {
      p_question_key: q.key,
      p_value: value,
      p_type: q.type,
    })
    if (data?.duplicate) {
      setDupWarning({ label: q.label, deskNumber: data.desk_number })
    }
  }

  function validate() {
    const newErrors = {}
    for (const q of config.questions) {
      if (q.required && !(answers[q.key] || '').trim()) {
        newErrors[q.key] = 'Required'
      }
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function resetForm() {
    setAnswers({})
    setErrors({})
    setDupWarning(null)
    requestAnimationFrame(() => {
      const firstKey = firstFieldKeyRef.current
      if (firstKey) fieldRefs.current[firstKey]?.focus()
    })
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (submitting) return
    if (!validate()) return

    setSubmitting(true)
    setDupWarning(null)

    if (!navigator.onLine) {
      const queue = loadQueue()
      queue.push({ sessionToken, answers })
      saveQueue(queue)
      setPendingCount(queue.length)
      showToast('Offline — saved, will sync automatically')
      setSubmitting(false)
      resetForm()
      return
    }

    const { data, error } = await supabase.rpc('submit_registration', {
      p_session_token: sessionToken,
      p_answers: answers,
    })

    setSubmitting(false)

    if (error) {
      const msg = error.message || ''
      if (msg.includes('DUPLICATE')) {
        const parts = msg.split('|')
        setDupWarning({ label: parts[1] || 'Field', deskNumber: parts[2] || '?' })
        return
      }
      if (msg.includes('invalid_session')) {
        onLogout(true)
        return
      }
      if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')) {
        const queue = loadQueue()
        queue.push({ sessionToken, answers })
        saveQueue(queue)
        setPendingCount(queue.length)
        showToast('Network issue — saved, will sync automatically')
        resetForm()
        return
      }
      showToast('Something went wrong — please try again', 'error')
      return
    }

    showToast(`Registered! #${data.registration_id}`)
    setStats((s) => ({ desk_count: s.desk_count + 1, total_count: s.total_count + 1 }))
    resetForm()
  }

  function handleFieldKeyDown(e, index) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const isLast = index === config.questions.length - 1
    if (isLast) {
      handleSubmit()
    } else {
      const nextKey = config.questions[index + 1].key
      fieldRefs.current[nextKey]?.focus()
    }
  }

  async function handleLogout() {
    await supabase.rpc('release_desk', { p_session_token: sessionToken })
    onLogout(false)
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400">
        Loading...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 transition-colors flex flex-col">
      {/* Top bar */}
      <header className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 px-4 py-2">
        {config.banner_url && (
          <img
            src={config.banner_url}
            alt="Event banner"
            className="w-full max-h-24 object-cover rounded-lg mb-2"
          />
        )}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">{config.event_name}</h1>
            <span className="px-2.5 py-1 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold tracking-wide">
              DESK {deskNumber}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">
              Desk: <strong className="text-neutral-900 dark:text-white">{stats.desk_count}</strong> | Total:{' '}
              <strong className="text-neutral-900 dark:text-white">{stats.total_count}</strong>
            </span>
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-medium">
                <WifiOff size={12} /> Pending Sync ({pendingCount})
              </span>
            )}
            <button
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              className="p-2 rounded-full text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 dark:text-neutral-400 transition"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>
      </header>

      {!isOnline && (
        <div className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-sm text-center py-1.5">
          You're offline — registrations will be saved locally and synced automatically.
        </div>
      )}

      {/* Form */}
      <main className="flex-1 flex items-start justify-center pt-10 px-4">
        <form onSubmit={handleSubmit} className="w-full max-w-lg flex flex-col gap-4">
          {dupWarning && (
            <div className="px-4 py-3 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-sm font-medium">
              Duplicate detected: {dupWarning.label} already registered at Desk {dupWarning.deskNumber}
            </div>
          )}

          {config.questions.map((q, index) => (
            <div key={q.key} className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {q.label}
                {q.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>

              {q.type === 'select' ? (
                <select
                  ref={(el) => (fieldRefs.current[q.key] = el)}
                  value={answers[q.key] || ''}
                  onChange={(e) => updateAnswer(q.key, e.target.value)}
                  onKeyDown={(e) => handleFieldKeyDown(e, index)}
                  onBlur={() => handleBlurDuplicateCheck(q)}
                  className="w-full text-lg px-4 py-3 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                >
                  <option value="">Select...</option>
                  {(q.options || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  ref={(el) => (fieldRefs.current[q.key] = el)}
                  type={q.type === 'number' ? 'number' : q.type === 'tel' ? 'tel' : q.type === 'email' ? 'email' : 'text'}
                  value={answers[q.key] || ''}
                  onChange={(e) => updateAnswer(q.key, e.target.value)}
                  onKeyDown={(e) => handleFieldKeyDown(e, index)}
                  onBlur={() => handleBlurDuplicateCheck(q)}
                  className="w-full text-lg px-4 py-3 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                />
              )}

              {errors[q.key] && <p className="text-xs text-red-500">{errors[q.key]}</p>}
            </div>
          ))}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full py-3.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-lg hover:opacity-90 transition disabled:opacity-50"
          >
            {submitting ? 'Registering...' : 'Register (Enter)'}
          </button>
        </form>
      </main>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl shadow-lg font-medium text-white animate-toast-in ${
            toast.kind === 'error' ? 'bg-red-600' : 'bg-green-600'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
