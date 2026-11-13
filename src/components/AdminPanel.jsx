import { useCallback, useEffect, useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase, BANNER_BUCKET } from '../lib/supabase'
import { exportRegistrationsToExcel } from '../utils/excelExport'
import { LogOut, Moon, Plus, Sun, Trash2, ArrowUp, ArrowDown, Upload } from 'lucide-react'

const QUESTION_TYPES = ['text', 'number', 'tel', 'email', 'select']

function emptyQuestion() {
  return {
    key: `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    label: '',
    type: 'text',
    required: false,
    check_duplicate: false,
    options: [],
  }
}

export default function AdminPanel({ adminCode, onLogout, theme, toggleTheme }) {
  const [dashboard, setDashboard] = useState(null)
  const [eventName, setEventName] = useState('')
  const [bannerUrl, setBannerUrl] = useState(null)
  const [questions, setQuestions] = useState([])
  const [newDeskCode, setNewDeskCode] = useState('')
  const [newAdminCode, setNewAdminCode] = useState('')
  const [status, setStatus] = useState('')
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState('setup')
  const fileInputRef = useRef(null)

  const loadDashboard = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_dashboard', { p_admin_code: adminCode })
    if (error) {
      setStatus('Session expired or invalid code — please log in again.')
      return
    }
    setDashboard(data)
    setEventName(data.event_name)
    setBannerUrl(data.banner_url)
    setQuestions((data.questions || []).map((q) => ({ ...q, options: q.options || [] })))
  }, [adminCode])

  useEffect(() => {
    loadDashboard()
    const interval = setInterval(loadDashboard, 15000) // keep desk list / counts fresh
    return () => clearInterval(interval)
  }, [loadDashboard])

  function flash(msg) {
    setStatus(msg)
    setTimeout(() => setStatus(''), 3000)
  }

  async function handleSaveEventInfo() {
    const { error } = await supabase.rpc('admin_update_event', {
      p_admin_code: adminCode,
      p_event_name: eventName,
      p_banner_url: bannerUrl,
    })
    if (error) return flash('Failed to save event info.')
    flash('Event info saved.')
    loadDashboard()
  }

  async function handleBannerChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.15,
        maxWidthOrHeight: 1600,
        fileType: 'image/webp',
        useWebWorker: true,
      })

      // Remove old banner first (keeps storage near 0 for next event)
      if (bannerUrl) {
        const oldPath = bannerUrl.split(`${BANNER_BUCKET}/`)[1]
        if (oldPath) await supabase.storage.from(BANNER_BUCKET).remove([oldPath])
      }

      const path = `banner_${Date.now()}.webp`
      const { error: uploadError } = await supabase.storage.from(BANNER_BUCKET).upload(path, compressed, {
        contentType: 'image/webp',
        upsert: true,
      })
      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage.from(BANNER_BUCKET).getPublicUrl(path)
      setBannerUrl(publicUrlData.publicUrl)
      flash('Banner uploaded — click Save to apply.')
    } catch (err) {
      flash('Banner upload failed: ' + (err.message || 'unknown error'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleUpdateCodes() {
    if (!newDeskCode && !newAdminCode) return flash('Enter a new desk code and/or admin code.')
    const { error } = await supabase.rpc('admin_update_codes', {
      p_admin_code: adminCode,
      p_new_desk_code: newDeskCode || null,
      p_new_admin_code: newAdminCode || null,
    })
    if (error) return flash('Failed to update codes.')
    setNewDeskCode('')
    setNewAdminCode('')
    flash('Codes updated.' + (newAdminCode ? ' Log in again with your new admin code next time.' : ''))
  }

  function addQuestion() {
    setQuestions((qs) => [...qs, emptyQuestion()])
  }
  function removeQuestion(index) {
    setQuestions((qs) => qs.filter((_, i) => i !== index))
  }
  function moveQuestion(index, dir) {
    setQuestions((qs) => {
      const next = [...qs]
      const target = index + dir
      if (target < 0 || target >= next.length) return qs
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  function updateQuestion(index, patch) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  }

  async function handleSaveQuestions() {
    const cleaned = questions.map((q) => ({
      key: q.key,
      label: q.label.trim() || 'Untitled Question',
      type: q.type,
      required: !!q.required,
      check_duplicate: !!q.check_duplicate,
      options: q.type === 'select' ? q.options : undefined,
    }))
    const { error } = await supabase.rpc('admin_update_questions', {
      p_admin_code: adminCode,
      p_questions: cleaned,
    })
    if (error) return flash('Failed to save questions.')
    flash('Questions saved.')
    loadDashboard()
  }

  async function handleForceRelease(deskNumber) {
    const { error } = await supabase.rpc('admin_force_release_desk', {
      p_admin_code: adminCode,
      p_desk_number: deskNumber,
    })
    if (error) return flash('Failed to release desk.')
    flash(`Desk ${deskNumber} released.`)
    loadDashboard()
  }

  async function handleExport() {
    const { data, error } = await supabase.rpc('admin_get_registrations', { p_admin_code: adminCode })
    if (error) return flash('Failed to fetch registrations.')
    if (!data || data.length === 0) return flash('No registrations yet.')
    exportRegistrationsToExcel(data, dashboard.questions, dashboard.event_name)
  }

  async function handleResetEvent() {
    if (!confirm('This will permanently delete ALL registrations, release all desks, and remove the current banner. Continue?')) {
      return
    }
    const { data, error } = await supabase.rpc('admin_reset_event', { p_admin_code: adminCode })
    if (error) return flash('Failed to reset event.')
    if (data?.old_banner_url) {
      const oldPath = data.old_banner_url.split(`${BANNER_BUCKET}/`)[1]
      if (oldPath) await supabase.storage.from(BANNER_BUCKET).remove([oldPath])
    }
    setBannerUrl(null)
    flash('Event reset. Ready for the next one.')
    loadDashboard()
  }

  if (!dashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400">
        {status || 'Loading...'}
      </div>
    )
  }

  const tabs = [
    { id: 'setup', label: 'Event Setup' },
    { id: 'questions', label: 'Questions' },
    { id: 'desks', label: 'Desks & Data' },
  ]

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 transition-colors">
      <header className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Admin Panel</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="p-2 rounded-full text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 dark:text-neutral-400 transition"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
          >
            <LogOut size={14} /> Logout
          </button>
        </div>
      </header>

      <nav className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 px-6 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? 'border-neutral-900 dark:border-white text-neutral-900 dark:text-white'
                : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {status && (
        <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm text-center py-2">
          {status}
        </div>
      )}

      <main className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
        {tab === 'setup' && (
          <>
            <section className="bg-white dark:bg-neutral-800 rounded-2xl p-5 flex flex-col gap-4">
              <h2 className="font-semibold text-neutral-900 dark:text-white">Event Info</h2>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Event Name</label>
                <input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  className="px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Event Banner</label>
                {bannerUrl && <img src={bannerUrl} alt="Banner preview" className="w-full h-28 object-cover rounded-lg" />}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition disabled:opacity-50"
                >
                  <Upload size={14} /> {uploading ? 'Compressing & uploading...' : 'Upload / Replace Banner'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} />
              </div>

              <button
                onClick={handleSaveEventInfo}
                className="py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium hover:opacity-90 transition"
              >
                Save Event Info
              </button>
            </section>

            <section className="bg-white dark:bg-neutral-800 rounded-2xl p-5 flex flex-col gap-4">
              <h2 className="font-semibold text-neutral-900 dark:text-white">Access Codes</h2>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">New Desk Security Code</label>
                <input
                  type="text"
                  value={newDeskCode}
                  onChange={(e) => setNewDeskCode(e.target.value)}
                  placeholder="Leave blank to keep current"
                  className="px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">New Admin Passcode</label>
                <input
                  type="text"
                  value={newAdminCode}
                  onChange={(e) => setNewAdminCode(e.target.value)}
                  placeholder="Leave blank to keep current"
                  className="px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                />
              </div>
              <button
                onClick={handleUpdateCodes}
                className="py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium hover:opacity-90 transition"
              >
                Update Codes
              </button>
            </section>
          </>
        )}

        {tab === 'questions' && (
          <section className="bg-white dark:bg-neutral-800 rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-neutral-900 dark:text-white">Registration Questions</h2>
              <button
                onClick={addQuestion}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 transition"
              >
                <Plus size={14} /> Add
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {questions.map((q, index) => (
                <div
                  key={q.key}
                  className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 flex flex-col gap-2"
                >
                  <div className="flex gap-2">
                    <input
                      value={q.label}
                      onChange={(e) => updateQuestion(index, { label: e.target.value })}
                      placeholder="Question label"
                      className="flex-1 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                    />
                    <select
                      value={q.type}
                      onChange={(e) => updateQuestion(index, { type: e.target.value })}
                      className="px-2 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white text-sm"
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  {q.type === 'select' && (
                    <input
                      value={(q.options || []).join(', ')}
                      onChange={(e) =>
                        updateQuestion(index, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                      }
                      placeholder="Comma-separated options e.g. Yes, No"
                      className="px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                    />
                  )}

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-4 text-sm text-neutral-600 dark:text-neutral-300">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={(e) => updateQuestion(index, { required: e.target.checked })}
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={q.check_duplicate}
                          onChange={(e) => updateQuestion(index, { check_duplicate: e.target.checked })}
                        />
                        Check Duplicate
                      </label>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveQuestion(index, -1)}
                        disabled={index === 0}
                        className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveQuestion(index, 1)}
                        disabled={index === questions.length - 1}
                        className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeQuestion(index)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {questions.length === 0 && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-4">
                  No questions yet — add one above.
                </p>
              )}
            </div>

            <button
              onClick={handleSaveQuestions}
              className="py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium hover:opacity-90 transition"
            >
              Save Questions
            </button>
          </section>
        )}

        {tab === 'desks' && (
          <>
            <section className="bg-white dark:bg-neutral-800 rounded-2xl p-5 flex flex-col gap-3">
              <h2 className="font-semibold text-neutral-900 dark:text-white">
                Active Desks <span className="text-neutral-400 font-normal">(refreshes automatically)</span>
              </h2>
              {dashboard.active_desks.length === 0 && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">No active desks right now.</p>
              )}
              {dashboard.active_desks.map((d) => (
                <div
                  key={d.desk_number}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900"
                >
                  <div className="text-sm text-neutral-700 dark:text-neutral-300">
                    <strong className="text-neutral-900 dark:text-white">Desk {d.desk_number}</strong> — {d.registrations} registered
                  </div>
                  <button
                    onClick={() => handleForceRelease(d.desk_number)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition"
                  >
                    Force Release
                  </button>
                </div>
              ))}
              <p className="text-sm text-neutral-500 dark:text-neutral-400 pt-2 border-t border-neutral-100 dark:border-neutral-700">
                Total registrations: <strong className="text-neutral-900 dark:text-white">{dashboard.total_registrations}</strong>
              </p>
            </section>

            <section className="bg-white dark:bg-neutral-800 rounded-2xl p-5 flex flex-col gap-3">
              <h2 className="font-semibold text-neutral-900 dark:text-white">Export</h2>
              <button
                onClick={handleExport}
                className="py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium hover:opacity-90 transition"
              >
                Download Excel (.xlsx)
              </button>
            </section>

            <section className="bg-white dark:bg-neutral-800 rounded-2xl p-5 flex flex-col gap-3 border border-red-200 dark:border-red-900/50">
              <h2 className="font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Deletes all registrations, releases all desks, and removes the current banner. Export your data first.
              </p>
              <button
                onClick={handleResetEvent}
                className="py-2.5 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition"
              >
                Reset Event
              </button>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
