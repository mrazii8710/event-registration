import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowLeft, LogOut, Moon, Plus, Sun, Trash2, WifiOff } from 'lucide-react'
import CheckInLookup from './CheckInLookup'

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
function enqueue(item) {
  const queue = loadQueue()
  queue.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...item })
  saveQueue(queue)
  return queue.length
}
function isNetworkError(error) {
  const msg = (error?.message || '').toLowerCase()
  return !navigator.onLine || msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
}
function hasPrereg(cfg) {
  return (cfg?.prereg?.total || 0) > 0
}

function fieldInputType(type) {
  if (type === 'number') return 'number'
  if (type === 'tel') return 'tel'
  if (type === 'email') return 'email'
  return 'text'
}

export default function RegistrationDesk({ deskNumber, sessionToken, operatorName, onLogout, theme, toggleTheme }) {
  const [config, setConfig] = useState(null)
  const [answers, setAnswers] = useState({})
  const [groupCounts, setGroupCounts] = useState({}) // { [groupKey]: number of instances }
  const [errors, setErrors] = useState({})
  const [dupWarning, setDupWarning] = useState(null)
  const [toast, setToast] = useState(null)
  const [stats, setStats] = useState({ desk_count: 0, total_count: 0 })
  const [statPulse, setStatPulse] = useState(false)
  const [pendingCount, setPendingCount] = useState(loadQueue().length)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState('lookup') // 'lookup' (search the pre-registered list) | 'form'

  const fieldRefs = useRef({})
  const flushing = useRef(false)
  const toastTimer = useRef(null)
  const answersRef = useRef(answers)
  answersRef.current = answers

  const refreshStats = useCallback(async () => {
    const { data } = await supabase.rpc('get_desk_stats', { p_desk_number: deskNumber })
    if (data) setStats(data)
  }, [deskNumber])

  useEffect(() => {
    supabase.rpc('get_event_config').then(({ data }) => {
      if (data) {
        setConfig(data)
        setMode(hasPrereg(data) ? 'lookup' : 'form')
        const initialCounts = {}
        for (const q of data.questions || []) {
          if (q.type === 'group') initialCounts[q.key] = Math.max(1, q.group?.min || 1)
        }
        setGroupCounts(initialCounts)
      }
    })
    refreshStats()
  }, [refreshStats])

  useEffect(() => {
    if (mode === 'form' && config?.questions?.length) {
      const first = config.questions[0]
      if (first.type === 'group') {
        fieldRefs.current[`${first.key}.0.${first.group.fields[0]?.key}`]?.focus()
      } else {
        fieldRefs.current[first.key]?.focus()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.questions, mode])

  useEffect(() => {
    const interval = setInterval(async () => {
      const { error } = await supabase.rpc('heartbeat_desk', { p_session_token: sessionToken })
      // A wifi blip must not kick the desk out; only an expired desk does.
      if (error && (error.message || '').includes('desk_expired')) {
        onLogout(true)
        return
      }
      if (error) return
      // Pick up a list the admin uploaded (or removed) after this desk logged in.
      const { data } = await supabase.rpc('get_event_config')
      if (data?.prereg) {
        setConfig((c) => {
          if (!c) return c
          const had = hasPrereg(c)
          const now = hasPrereg(data)
          if (had !== now) {
            const formEmpty = Object.keys(answersRef.current).length === 0
            if (now && formEmpty) setMode('lookup')
            if (!now) setMode('form')
          }
          return { ...c, prereg: data.prereg }
        })
        refreshStats()
      }
    }, HEARTBEAT_MS)
    return () => clearInterval(interval)
  }, [sessionToken, onLogout, refreshStats])

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
    flushQueue()
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function flushQueue() {
    if (flushing.current) return // online event + mount can both fire
    flushing.current = true
    try {
      const snapshot = loadQueue()
      if (snapshot.length === 0) return
      const done = new Set()
      let duplicates = 0
      for (const item of snapshot) {
        // Re-send under this desk's current session (the old token may be gone after a re-login).
        const { error } = await supabase.rpc('submit_registration', {
          p_session_token: sessionToken,
          p_answers: item.answers,
        })
        if (!error) {
          done.add(item.id)
        } else if ((error.message || '').includes('DUPLICATE')) {
          done.add(item.id)
          duplicates++
        } else if (isNetworkError(error)) {
          break // still offline; keep the rest for next time
        }
      }
      // Re-read: items queued while this was running must not be lost.
      const remaining = loadQueue().filter((i) => !done.has(i.id))
      saveQueue(remaining)
      setPendingCount(remaining.length)
      if (done.size) refreshStats()
      if (duplicates) showToast(`${duplicates} offline entr${duplicates === 1 ? 'y was' : 'ies were'} already registered, skipped`, 'error')
    } finally {
      flushing.current = false
    }
  }

  function showToast(message, kind = 'success', action = null) {
    clearTimeout(toastTimer.current)
    setToast({ message, kind, action })
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 2600)
  }

  function handleMarked({ id, name }) {
    showToast(`${name} checked in`, 'success', {
      label: 'Undo',
      onClick: async () => {
        setToast(null)
        const { data, error } = await supabase.rpc('desk_undo_attendance', { p_session_token: sessionToken, p_prereg_id: id })
        if (error || !data?.undone) return showToast('Could not undo', 'error')
        showToast(`Check-in for ${name} undone`)
        refreshStats()
      },
    })
    setStatPulse(true)
    setTimeout(() => setStatPulse(false), 350)
    refreshStats()
  }

  // "Register as new" from the search screen: carry over what was typed.
  function handleRegisterNew(typed) {
    const prefill = {}
    if (typed) {
      const isPhone = /^[0-9\s\-+().]+$/.test(typed)
      const top = config.questions.filter((q) => q.type !== 'group')
      const target = isPhone
        ? top.find((q) => q.type === 'tel' && /mobile|phone|whats/i.test(q.label)) || top.find((q) => q.type === 'tel')
        : top.find((q) => q.type === 'text' && /name/i.test(q.label))
      if (target) {
        prefill[target.key] = typed
      } else {
        const group = config.questions.find((q) => q.type === 'group')
        const field = group?.group?.fields?.find((f) => (isPhone ? f.type === 'tel' : /name/i.test(f.label)))
        if (field) prefill[group.key] = [{ [field.key]: typed }]
      }
    }
    resetForm(prefill)
    setMode('form')
  }

  function backToLookup() {
    resetForm()
    setMode('lookup')
  }

  // Flattened, ordered list of every focusable field (simple + inside groups)
  // so Enter-to-advance and Enter-to-submit work across the whole form.
  const flatFields = useMemo(() => {
    if (!config) return []
    const list = []
    for (const q of config.questions) {
      if (q.type === 'group') {
        const count = groupCounts[q.key] || 1
        for (let i = 0; i < count; i++) {
          for (const f of q.group.fields) {
            list.push({ focusKey: `${q.key}.${i}.${f.key}`, groupKey: q.key, instanceIndex: i, field: f })
          }
        }
      } else {
        list.push({ focusKey: q.key, q })
        if (q.type === 'select' && q.other_trigger && answers[q.key] === q.other_trigger) {
          for (const f of q.other_fields || []) {
            list.push({ focusKey: `${q.key}__other.${f.key}`, otherKey: q.key, field: f })
          }
        }
      }
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, groupCounts, answers])

  function updateAnswer(key, value) {
    setAnswers((a) => ({ ...a, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setDupWarning(null)
  }

  function updateOtherAnswer(qKey, fieldKey, value) {
    setAnswers((a) => ({ ...a, [`${qKey}__other`]: { ...(a[`${qKey}__other`] || {}), [fieldKey]: value } }))
    setErrors((e) => ({ ...e, [`${qKey}__other.${fieldKey}`]: undefined }))
  }

  function updateGroupAnswer(groupKey, index, fieldKey, value) {
    setAnswers((a) => {
      const arr = Array.isArray(a[groupKey]) ? [...a[groupKey]] : []
      arr[index] = { ...(arr[index] || {}), [fieldKey]: value }
      return { ...a, [groupKey]: arr }
    })
    setErrors((e) => ({ ...e, [`${groupKey}.${index}.${fieldKey}`]: undefined }))
  }

  function addGroupInstance(q) {
    const max = q.group?.max || 10
    setGroupCounts((c) => ({ ...c, [q.key]: Math.min(max, (c[q.key] || 1) + 1) }))
  }

  function removeGroupInstance(q, index) {
    const min = Math.max(1, q.group?.min || 1)
    setGroupCounts((c) => {
      const current = c[q.key] || 1
      if (current <= min) return c
      return { ...c, [q.key]: current - 1 }
    })
    setAnswers((a) => {
      const arr = Array.isArray(a[q.key]) ? [...a[q.key]] : []
      arr.splice(index, 1)
      return { ...a, [q.key]: arr }
    })
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
    if (data?.duplicate) setDupWarning({ label: q.label, deskNumber: data.desk_number })
  }

  function validate() {
    const newErrors = {}
    for (const q of config.questions) {
      if (q.type === 'group') {
        const count = groupCounts[q.key] || 1
        for (let i = 0; i < count; i++) {
          for (const f of q.group.fields) {
            if (f.required && !(answers[q.key]?.[i]?.[f.key] || '').toString().trim()) {
              newErrors[`${q.key}.${i}.${f.key}`] = 'Required'
            }
          }
        }
      } else if (q.required && !(answers[q.key] || '').trim()) {
        newErrors[q.key] = 'Required'
      }
      if (q.type === 'select' && q.other_trigger && answers[q.key] === q.other_trigger) {
        for (const f of q.other_fields || []) {
          if (f.required && !(answers[`${q.key}__other`]?.[f.key] || '').toString().trim()) {
            newErrors[`${q.key}__other.${f.key}`] = 'Required'
          }
        }
      }
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function resetForm(prefill = {}) {
    setAnswers(prefill)
    setErrors({})
    setDupWarning(null)
    const initialCounts = {}
    for (const q of config.questions) {
      if (q.type === 'group') initialCounts[q.key] = Math.max(1, q.group?.min || 1)
    }
    setGroupCounts(initialCounts)
    if (hasPrereg(config)) return // the search screen takes focus itself
    requestAnimationFrame(() => {
      const first = config.questions[0]
      if (!first) return
      if (first.type === 'group') {
        fieldRefs.current[`${first.key}.0.${first.group.fields[0]?.key}`]?.focus()
      } else {
        fieldRefs.current[first.key]?.focus()
      }
    })
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (submitting) return
    if (!validate()) return

    setSubmitting(true)
    setDupWarning(null)

    if (!navigator.onLine) {
      setPendingCount(enqueue({ sessionToken, answers }))
      showToast('Offline — saved, will sync automatically')
      setSubmitting(false)
      resetForm()
      if (hasPrereg(config)) setMode('lookup')
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
      if (isNetworkError(error)) {
        setPendingCount(enqueue({ sessionToken, answers }))
        showToast('Network issue — saved, will sync automatically')
        resetForm()
        if (hasPrereg(config)) setMode('lookup')
        return
      }
      showToast('Something went wrong — please try again', 'error')
      return
    }

    showToast(`Registered! #${data.registration_id}`)
    setStats((s) => ({ desk_count: s.desk_count + 1, total_count: s.total_count + 1 }))
    setStatPulse(true)
    setTimeout(() => setStatPulse(false), 350)
    resetForm()
    if (hasPrereg(config)) setMode('lookup')
  }

  function handleFieldKeyDown(e, flatIndex) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const isLast = flatIndex === flatFields.length - 1
    if (isLast) {
      handleSubmit()
    } else {
      const next = flatFields[flatIndex + 1]
      fieldRefs.current[next.focusKey]?.focus()
    }
  }

  async function handleLogout() {
    await supabase.rpc('release_desk', { p_session_token: sessionToken })
    onLogout(false)
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper dark:bg-ink-950 text-ink-500 dark:text-ink-400 font-display">
        {'Loading…'}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper dark:bg-ink-950 transition-colors flex flex-col">
      {/* Top bar */}
      <header className="bg-cream dark:bg-ink-800 border-b border-ink-100 dark:border-ink-700 px-4 py-2.5">
        {config.banner_url && (
          <img src={config.banner_url} alt="Event banner" className="w-full max-h-24 object-cover rounded-xl mb-2.5" />
        )}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h1 className="font-display font-semibold text-lg text-ink-900 dark:text-white">{config.event_name}</h1>
            <span className="rounded-md px-3 py-1.5 bg-marigold-500 text-white text-xs font-display font-semibold tracking-wide">
              DESK {deskNumber}
              {operatorName && (
                <span className="font-body font-medium ml-1.5 opacity-70">{`· ${operatorName}`}</span>
              )}
            </span>
          </div>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm">
            {hasPrereg(config) && (
              <span className="text-ink-500 dark:text-ink-400 whitespace-nowrap">
                {'Checked in '}
                <strong
                  className={`inline-block text-ink-900 dark:text-white font-display ${statPulse ? 'animate-pulse-once text-marigold-500 dark:text-marigold-400' : ''}`}
                >
                  {stats.checkin_total ?? 0}
                </strong>
                {`/${stats.prereg_total ?? config.prereg.total}`}
              </span>
            )}
            <span className="text-ink-500 dark:text-ink-400 whitespace-nowrap">
              {hasPrereg(config) ? 'New: desk ' : 'Desk '}
              <strong
                className={`inline-block text-ink-900 dark:text-white font-display ${statPulse ? 'animate-pulse-once text-marigold-500 dark:text-marigold-400' : ''}`}
              >
                {stats.desk_count}
              </strong>
              {' · Total '}
              <strong
                className={`inline-block text-ink-900 dark:text-white font-display ${statPulse ? 'animate-pulse-once text-marigold-500 dark:text-marigold-400' : ''}`}
              >
                {stats.total_count}
              </strong>
            </span>
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-marigold-500/15 text-marigold-600 dark:text-marigold-400 text-xs font-medium">
                <WifiOff size={12} /> Pending ({pendingCount})
              </span>
            )}
            <button
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              className="p-2 rounded-full text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-700 dark:text-ink-400 transition"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-700 transition"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>
      </header>

      {!isOnline && (
        <div className="bg-marigold-500/15 text-marigold-700 dark:text-marigold-400 text-sm text-center py-1.5">
          {"You're offline — registrations will be saved locally and synced automatically."}
        </div>
      )}

      <main className="flex-1 flex items-start justify-center pt-8 px-4 pb-10">
        {mode === 'lookup' && hasPrereg(config) ? (
          <CheckInLookup
            sessionToken={sessionToken}
            prereg={config.prereg}
            isOnline={isOnline}
            onMarked={handleMarked}
            onRegisterNew={handleRegisterNew}
            onSessionExpired={() => onLogout(true)}
            showToast={showToast}
          />
        ) : (
        <form onSubmit={handleSubmit} className="w-full max-w-lg flex flex-col gap-4">
          {hasPrereg(config) && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={backToLookup}
                className="flex items-center gap-1.5 px-3 py-2 -ml-3 rounded-lg text-sm text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 transition"
              >
                <ArrowLeft size={16} /> Back to search
              </button>
              <span className="text-xs font-medium rounded-full px-2.5 py-1 bg-lagoon-50 dark:bg-ink-800 text-lagoon-600 dark:text-lagoon-400">
                New registration
              </span>
            </div>
          )}
          {dupWarning && (
            <div className="px-4 py-3 rounded-lg bg-flare-500/10 text-flare-600 dark:text-flare-400 text-sm font-medium animate-fade-up">
              Duplicate detected: {dupWarning.label} already registered at Desk {dupWarning.deskNumber}
            </div>
          )}

          {config.questions.map((q) => {
            if (q.type === 'group') {
              const count = groupCounts[q.key] || 1
              const max = q.group?.max || 10
              const min = Math.max(1, q.group?.min || 1)
              return (
                <div key={q.key} className="flex flex-col gap-2.5">
                  <label className="text-sm font-medium text-ink-700 dark:text-ink-100">
                    {q.group?.item_label || 'Entry'}
                    {q.required && <span className="text-flare-500 ml-0.5">*</span>}
                  </label>
                  {Array.from({ length: count }).map((_, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-ink-100 dark:border-ink-700 bg-cream dark:bg-ink-800 p-3 flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-display font-semibold text-ink-400 dark:text-ink-500">
                          {q.group?.item_label || 'Entry'} {idx + 1}
                        </span>
                        {count > min && (
                          <button
                            type="button"
                            onClick={() => removeGroupInstance(q, idx)}
                            className="text-ink-400 hover:text-flare-500 transition p-1"
                            aria-label="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {q.group.fields.map((f) => {
                          const flatIndex = flatFields.findIndex(
                            (ff) => ff.focusKey === `${q.key}.${idx}.${f.key}`
                          )
                          const errKey = `${q.key}.${idx}.${f.key}`
                          return (
                            <div key={f.key} className="flex flex-col gap-1">
                              <input
                                ref={(el) => (fieldRefs.current[`${q.key}.${idx}.${f.key}`] = el)}
                                type={fieldInputType(f.type)}
                                placeholder={f.label}
                                value={answers[q.key]?.[idx]?.[f.key] || ''}
                                onChange={(e) => updateGroupAnswer(q.key, idx, f.key, e.target.value)}
                                onKeyDown={(e) => handleFieldKeyDown(e, flatIndex)}
                                className="w-full px-3 py-2.5 rounded-lg border border-ink-100 dark:border-ink-600 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-marigold-500"
                              />
                              {errors[errKey] && <p className="text-xs text-flare-500">{errors[errKey]}</p>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {count < max && (
                    <button
                      type="button"
                      onClick={() => addGroupInstance(q)}
                      className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-ink-200 dark:border-ink-600 text-sm text-ink-500 dark:text-ink-400 hover:border-marigold-500 hover:text-marigold-600 transition"
                    >
                      <Plus size={14} /> Add {q.group?.item_label || 'entry'}
                    </button>
                  )}
                </div>
              )
            }

            const flatIndex = flatFields.findIndex((ff) => ff.focusKey === q.key)
            return (
              <div key={q.key} className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700 dark:text-ink-100">
                  {q.label}
                  {q.required && <span className="text-flare-500 ml-0.5">*</span>}
                </label>

                {q.type === 'select' ? (
                  <>
                    <select
                      ref={(el) => (fieldRefs.current[q.key] = el)}
                      value={answers[q.key] || ''}
                      onChange={(e) => {
                        const value = e.target.value
                        updateAnswer(q.key, value)
                        if (q.other_trigger && value !== q.other_trigger) {
                          setAnswers((a) => {
                            const { [`${q.key}__other`]: _drop, ...rest } = a
                            return rest
                          })
                        }
                      }}
                      onKeyDown={(e) => handleFieldKeyDown(e, flatIndex)}
                      onBlur={() => handleBlurDuplicateCheck(q)}
                      className="w-full text-lg px-4 py-3 rounded-xl border border-ink-100 dark:border-ink-700 bg-cream dark:bg-ink-800 text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-marigold-500"
                    >
                      <option value="">{'Select…'}</option>
                      {(q.options || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>

                    {q.other_trigger && answers[q.key] === q.other_trigger && (
                      <div className="flex flex-col gap-2 rounded-xl border border-ink-100 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 p-3 animate-fade-up">
                        {(q.other_fields || []).map((f) => {
                          const focusKey = `${q.key}__other.${f.key}`
                          const otherFlatIndex = flatFields.findIndex((ff) => ff.focusKey === focusKey)
                          return (
                            <div key={f.key} className="flex flex-col gap-1">
                              <label className="text-xs font-medium text-ink-600 dark:text-ink-300">
                                {f.label}
                                {f.required && <span className="text-flare-500 ml-0.5">*</span>}
                              </label>
                              <input
                                ref={(el) => (fieldRefs.current[focusKey] = el)}
                                type={fieldInputType(f.type)}
                                value={answers[`${q.key}__other`]?.[f.key] || ''}
                                onChange={(e) => updateOtherAnswer(q.key, f.key, e.target.value)}
                                onKeyDown={(e) => handleFieldKeyDown(e, otherFlatIndex)}
                                className="w-full px-3 py-2 rounded-lg border border-ink-200 dark:border-ink-600 bg-cream dark:bg-ink-800 text-ink-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-marigold-500"
                              />
                              {errors[focusKey] && <p className="text-xs text-flare-500">{errors[focusKey]}</p>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <input
                    ref={(el) => (fieldRefs.current[q.key] = el)}
                    type={fieldInputType(q.type)}
                    value={answers[q.key] || ''}
                    onChange={(e) => updateAnswer(q.key, e.target.value)}
                    onKeyDown={(e) => handleFieldKeyDown(e, flatIndex)}
                    onBlur={() => handleBlurDuplicateCheck(q)}
                    className="w-full text-lg px-4 py-3 rounded-xl border border-ink-100 dark:border-ink-700 bg-cream dark:bg-ink-800 text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-marigold-500"
                  />
                )}

                {errors[q.key] && <p className="text-xs text-flare-500">{errors[q.key]}</p>}
              </div>
            )
          })}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full py-3.5 rounded-xl bg-marigold-500 dark:bg-marigold-400 text-white dark:text-ink-950 font-display font-semibold text-lg hover:opacity-90 active:scale-[0.99] transition disabled:opacity-50"
          >
            {submitting ? 'Registering…' : 'Register'}
          </button>
        </form>
        )}
      </main>

      {toast && (
        <div
          role="status"
          className={`fixed top-5 left-1/2 max-w-[92vw] flex items-center gap-4 px-5 py-3 rounded-lg shadow-md font-display font-semibold text-white animate-toast-in ${
            toast.kind === 'error' ? 'bg-flare-500' : 'bg-marigold-500'
          }`}
        >
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="shrink-0 px-3 py-1 rounded-md bg-white/20 hover:bg-white/30 text-sm transition"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
