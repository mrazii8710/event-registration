import { useCallback, useEffect, useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase, BANNER_BUCKET } from '../lib/supabase'
import { exportRegistrationsToExcel } from '../utils/excelExport'
import {
  LogOut,
  Moon,
  Plus,
  Sun,
  Trash2,
  ArrowUp,
  ArrowDown,
  Upload,
  Settings2,
  ListChecks,
  Users,
  Ticket,
} from 'lucide-react'

const QUESTION_TYPES = ['text', 'number', 'tel', 'email', 'select', 'group']

function uid() {
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`
}

function emptyQuestion() {
  return {
    key: `q_${uid()}`,
    label: '',
    type: 'text',
    required: false,
    check_duplicate: false,
    options: [],
  }
}

function makeGroupDefaults() {
  return {
    item_label: 'Student',
    min: 1,
    max: 10,
    fields: [
      { key: `name_${uid()}`, label: 'Name', type: 'text', required: true },
      { key: `age_${uid()}`, label: 'Age', type: 'number', required: false },
    ],
  }
}

export default function AdminPanel({ adminCode, onLogout, theme, toggleTheme }) {
  const [dashboard, setDashboard] = useState(null)
  const [eventName, setEventName] = useState('')
  const [bannerUrl, setBannerUrl] = useState(null)
  const [questions, setQuestions] = useState([])
  const [optionsDraft, setOptionsDraft] = useState({}) // { [questionKey]: raw comma text }
  const [newDeskCode, setNewDeskCode] = useState('')
  const [newAdminCode, setNewAdminCode] = useState('')
  const [status, setStatus] = useState('')
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState('setup')
  const fileInputRef = useRef(null)

  const loadDashboardFull = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_dashboard', { p_admin_code: adminCode })
    if (error) {
      setStatus('Session expired or invalid code — please log in again.')
      return
    }
    setDashboard(data)
    setEventName(data.event_name)
    setBannerUrl(data.banner_url)
    const qs = (data.questions || []).map((q) => ({ ...q, options: q.options || [] }))
    setQuestions(qs)
    const drafts = {}
    for (const q of qs) {
      if (q.type === 'select') drafts[q.key] = (q.options || []).join(', ')
    }
    setOptionsDraft(drafts)
  }, [adminCode])

  const refreshLiveStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_dashboard', { p_admin_code: adminCode })
    if (error) return
    setDashboard(data)
  }, [adminCode])

  useEffect(() => {
    loadDashboardFull()
    const interval = setInterval(refreshLiveStats, 15000)
    return () => clearInterval(interval)
  }, [loadDashboardFull, refreshLiveStats])

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
    loadDashboardFull()
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

  function handleTypeChange(index, newType) {
    setQuestions((qs) =>
      qs.map((q, i) => {
        if (i !== index) return q
        if (newType === 'group') {
          return { key: q.key, label: q.label, type: 'group', required: !!q.required, group: makeGroupDefaults() }
        }
        const { group, ...rest } = q
        return { ...rest, type: newType }
      })
    )
  }

  // Select options: typed freely in a draft string, only parsed into the
  // real options array on blur/save — otherwise every keystroke re-derives
  // the value and a trailing comma gets silently eaten before you can type
  // the next option.
  function handleOptionsDraftChange(key, text) {
    setOptionsDraft((d) => ({ ...d, [key]: text }))
  }
  function commitOptionsDraft(index, key) {
    const text = optionsDraft[key] || ''
    const parsed = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    updateQuestion(index, { options: parsed })
  }

  function addGroupField(qIndex) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex
          ? { ...q, group: { ...q.group, fields: [...q.group.fields, { key: `f_${uid()}`, label: '', type: 'text', required: false }] } }
          : q
      )
    )
  }
  function removeGroupField(qIndex, fIndex) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex ? { ...q, group: { ...q.group, fields: q.group.fields.filter((_, fi) => fi !== fIndex) } } : q
      )
    )
  }
  function updateGroupField(qIndex, fIndex, patch) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex
          ? { ...q, group: { ...q.group, fields: q.group.fields.map((f, fi) => (fi === fIndex ? { ...f, ...patch } : f)) } }
          : q
      )
    )
  }
  function updateGroupMeta(qIndex, patch) {
    setQuestions((qs) => qs.map((q, i) => (i === qIndex ? { ...q, group: { ...q.group, ...patch } } : q)))
  }

  async function handleSaveQuestions() {
    const cleaned = questions.map((q) => {
      if (q.type === 'select') {
        const text = optionsDraft[q.key] ?? (q.options || []).join(', ')
        const options = text.split(',').map((s) => s.trim()).filter(Boolean)
        return { key: q.key, label: q.label.trim() || 'Untitled Question', type: q.type, required: !!q.required, check_duplicate: !!q.check_duplicate, options }
      }
      if (q.type === 'group') {
        return {
          key: q.key,
          label: q.label.trim() || q.group.item_label || 'Group',
          type: 'group',
          required: !!q.required,
          group: {
            item_label: q.group.item_label?.trim() || 'Entry',
            min: Math.max(1, Number(q.group.min) || 1),
            max: Math.max(Math.max(1, Number(q.group.min) || 1), Number(q.group.max) || 10),
            fields: q.group.fields.map((f) => ({
              key: f.key,
              label: f.label.trim() || 'Field',
              type: f.type,
              required: !!f.required,
            })),
          },
        }
      }
      return {
        key: q.key,
        label: q.label.trim() || 'Untitled Question',
        type: q.type,
        required: !!q.required,
        check_duplicate: !!q.check_duplicate,
      }
    })
    const { error } = await supabase.rpc('admin_update_questions', {
      p_admin_code: adminCode,
      p_questions: cleaned,
    })
    if (error) return flash('Failed to save questions.')
    flash('Questions saved.')
    loadDashboardFull()
  }

  async function handleForceRelease(deskNumber) {
    const { error } = await supabase.rpc('admin_force_release_desk', {
      p_admin_code: adminCode,
      p_desk_number: deskNumber,
    })
    if (error) return flash('Failed to release desk.')
    flash(`Desk ${deskNumber} released.`)
    loadDashboardFull()
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
    loadDashboardFull()
  }

  if (!dashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper dark:bg-ink-950 text-ink-500 dark:text-ink-400 font-display">
        {status || 'Loading…'}
      </div>
    )
  }

  const navItems = [
    { id: 'setup', label: 'Event Setup', icon: Settings2 },
    { id: 'questions', label: 'Questions', icon: ListChecks },
    { id: 'desks', label: 'Desks & Data', icon: Users },
  ]

  return (
    <div className="min-h-screen bg-paper dark:bg-ink-950 transition-colors flex">
      <aside className="w-56 shrink-0 bg-ink-900 dark:bg-ink-950 border-r border-ink-800 flex flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="w-9 h-9 rounded-xl bg-marigold-500 flex items-center justify-center -rotate-3">
            <Ticket className="text-ink-900" size={18} />
          </div>
          <span className="font-display font-semibold text-white">Admin</span>
        </div>
        <nav className="flex-1 px-3 flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                  active ? 'bg-marigold-500 text-ink-900' : 'text-ink-300 hover:bg-ink-800'
                }`}
              >
                <Icon size={16} /> {item.label}
              </button>
            )
          })}
        </nav>
        <div className="p-3 flex flex-col gap-1 border-t border-ink-800">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-300 hover:bg-ink-800 transition"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} Toggle theme
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-300 hover:bg-ink-800 transition"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {status && (
          <div className="bg-lagoon-500/10 text-lagoon-600 dark:text-lagoon-400 text-sm text-center py-2 animate-rise-in">
            {status}
          </div>
        )}

        <main className="max-w-2xl mx-auto w-full p-6 flex flex-col gap-6">
          {tab === 'setup' && (
            <>
              <section className="bg-white dark:bg-ink-800 rounded-2xl p-5 flex flex-col gap-4 border border-ink-100 dark:border-ink-700">
                <h2 className="font-display font-semibold text-ink-900 dark:text-white">Event Info</h2>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-ink-700 dark:text-ink-100">Event Name</label>
                  <input
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    className="px-4 py-2.5 rounded-xl border border-ink-100 dark:border-ink-600 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-marigold-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-ink-700 dark:text-ink-100">Event Banner</label>
                  {bannerUrl && <img src={bannerUrl} alt="Banner preview" className="w-full h-28 object-cover rounded-xl" />}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-ink-200 dark:border-ink-600 text-sm text-ink-600 dark:text-ink-300 hover:border-marigold-500 transition disabled:opacity-50"
                  >
                    <Upload size={14} /> {uploading ? 'Compressing & uploading…' : 'Upload / Replace Banner'}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} />
                </div>

                <button
                  onClick={handleSaveEventInfo}
                  className="py-2.5 rounded-xl bg-ink-900 dark:bg-marigold-500 text-white dark:text-ink-900 font-display font-semibold hover:opacity-90 active:scale-[0.99] transition"
                >
                  Save Event Info
                </button>
              </section>

              <section className="bg-white dark:bg-ink-800 rounded-2xl p-5 flex flex-col gap-4 border border-ink-100 dark:border-ink-700">
                <h2 className="font-display font-semibold text-ink-900 dark:text-white">Access Codes</h2>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-ink-700 dark:text-ink-100">New Desk Security Code</label>
                  <input
                    type="text"
                    value={newDeskCode}
                    onChange={(e) => setNewDeskCode(e.target.value)}
                    placeholder="Leave blank to keep current"
                    className="px-4 py-2.5 rounded-xl border border-ink-100 dark:border-ink-600 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-marigold-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-ink-700 dark:text-ink-100">New Admin Passcode</label>
                  <input
                    type="text"
                    value={newAdminCode}
                    onChange={(e) => setNewAdminCode(e.target.value)}
                    placeholder="Leave blank to keep current"
                    className="px-4 py-2.5 rounded-xl border border-ink-100 dark:border-ink-600 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-marigold-500"
                  />
                </div>
                <button
                  onClick={handleUpdateCodes}
                  className="py-2.5 rounded-xl bg-ink-900 dark:bg-marigold-500 text-white dark:text-ink-900 font-display font-semibold hover:opacity-90 active:scale-[0.99] transition"
                >
                  Update Codes
                </button>
              </section>
            </>
          )}

          {tab === 'questions' && (
            <section className="bg-white dark:bg-ink-800 rounded-2xl p-5 flex flex-col gap-4 border border-ink-100 dark:border-ink-700">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-ink-900 dark:text-white">Registration Questions</h2>
                <button
                  onClick={addQuestion}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-ink-900 dark:bg-marigold-500 text-white dark:text-ink-900 hover:opacity-90 transition"
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {questions.map((q, index) => (
                  <div key={q.key} className="border border-ink-100 dark:border-ink-700 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        value={q.label}
                        onChange={(e) => updateQuestion(index, { label: e.target.value })}
                        placeholder="Question label"
                        className="flex-1 px-3 py-2 rounded-lg border border-ink-100 dark:border-ink-600 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-marigold-500"
                      />
                      <select
                        value={q.type}
                        onChange={(e) => handleTypeChange(index, e.target.value)}
                        className="px-2 py-2 rounded-lg border border-ink-100 dark:border-ink-600 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white text-sm"
                      >
                        {QUESTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t === 'group' ? 'group (repeatable)' : t}
                          </option>
                        ))}
                      </select>
                    </div>

                    {q.type === 'select' && (
                      <input
                        value={optionsDraft[q.key] ?? (q.options || []).join(', ')}
                        onChange={(e) => handleOptionsDraftChange(q.key, e.target.value)}
                        onBlur={() => commitOptionsDraft(index, q.key)}
                        placeholder="Comma-separated options e.g. Yes, No"
                        className="px-3 py-2 rounded-lg border border-ink-100 dark:border-ink-600 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-marigold-500"
                      />
                    )}

                    {q.type === 'group' && (
                      <div className="flex flex-col gap-2 bg-paper dark:bg-ink-900 rounded-lg p-3">
                        <div className="flex gap-2 items-center flex-wrap">
                          <input
                            value={q.group.item_label}
                            onChange={(e) => updateGroupMeta(index, { item_label: e.target.value })}
                            placeholder="Item name e.g. Student"
                            className="flex-1 min-w-[120px] px-3 py-1.5 rounded-lg border border-ink-100 dark:border-ink-600 bg-white dark:bg-ink-800 text-ink-900 dark:text-white text-sm"
                          />
                          <label className="text-xs text-ink-500 dark:text-ink-400 flex items-center gap-1">
                            Min
                            <input
                              type="number"
                              min={1}
                              value={q.group.min}
                              onChange={(e) => updateGroupMeta(index, { min: e.target.value })}
                              className="w-14 px-2 py-1.5 rounded-lg border border-ink-100 dark:border-ink-600 bg-white dark:bg-ink-800 text-ink-900 dark:text-white text-sm"
                            />
                          </label>
                          <label className="text-xs text-ink-500 dark:text-ink-400 flex items-center gap-1">
                            Max
                            <input
                              type="number"
                              min={1}
                              value={q.group.max}
                              onChange={(e) => updateGroupMeta(index, { max: e.target.value })}
                              className="w-14 px-2 py-1.5 rounded-lg border border-ink-100 dark:border-ink-600 bg-white dark:bg-ink-800 text-ink-900 dark:text-white text-sm"
                            />
                          </label>
                        </div>

                        <span className="text-xs font-medium text-ink-400 dark:text-ink-500">Fields per entry</span>
                        {q.group.fields.map((f, fIndex) => (
                          <div key={f.key} className="flex gap-2 items-center">
                            <input
                              value={f.label}
                              onChange={(e) => updateGroupField(index, fIndex, { label: e.target.value })}
                              placeholder="Field label e.g. Name"
                              className="flex-1 px-3 py-1.5 rounded-lg border border-ink-100 dark:border-ink-600 bg-white dark:bg-ink-800 text-ink-900 dark:text-white text-sm"
                            />
                            <select
                              value={f.type}
                              onChange={(e) => updateGroupField(index, fIndex, { type: e.target.value })}
                              className="px-2 py-1.5 rounded-lg border border-ink-100 dark:border-ink-600 bg-white dark:bg-ink-800 text-ink-900 dark:text-white text-sm"
                            >
                              {['text', 'number', 'tel', 'email'].map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <label className="text-xs text-ink-500 dark:text-ink-400 flex items-center gap-1 shrink-0">
                              <input
                                type="checkbox"
                                checked={f.required}
                                onChange={(e) => updateGroupField(index, fIndex, { required: e.target.checked })}
                              />
                              Req
                            </label>
                            <button
                              type="button"
                              onClick={() => removeGroupField(index, fIndex)}
                              className="p-1.5 rounded-lg text-flare-500 hover:bg-flare-500/10 shrink-0"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addGroupField(index)}
                          className="self-start flex items-center gap-1 text-xs text-ink-500 dark:text-ink-400 hover:text-marigold-600 transition"
                        >
                          <Plus size={12} /> Add field
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-4 text-sm text-ink-600 dark:text-ink-300">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={q.required}
                            onChange={(e) => updateQuestion(index, { required: e.target.checked })}
                          />
                          Required
                        </label>
                        {q.type !== 'group' && (
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={q.check_duplicate}
                              onChange={(e) => updateQuestion(index, { check_duplicate: e.target.checked })}
                            />
                            Check Duplicate
                          </label>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveQuestion(index, -1)}
                          disabled={index === 0}
                          className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-700 disabled:opacity-30"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveQuestion(index, 1)}
                          disabled={index === questions.length - 1}
                          className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-700 disabled:opacity-30"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeQuestion(index)}
                          className="p-1.5 rounded-lg text-flare-500 hover:bg-flare-500/10"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {questions.length === 0 && (
                  <p className="text-sm text-ink-500 dark:text-ink-400 text-center py-4">No questions yet — add one above.</p>
                )}
              </div>

              <button
                onClick={handleSaveQuestions}
                className="py-2.5 rounded-xl bg-ink-900 dark:bg-marigold-500 text-white dark:text-ink-900 font-display font-semibold hover:opacity-90 active:scale-[0.99] transition"
              >
                Save Questions
              </button>
            </section>
          )}

          {tab === 'desks' && (
            <>
              <section className="bg-white dark:bg-ink-800 rounded-2xl p-5 flex flex-col gap-3 border border-ink-100 dark:border-ink-700">
                <h2 className="font-display font-semibold text-ink-900 dark:text-white">Active Desks</h2>
                {dashboard.active_desks.length === 0 && (
                  <p className="text-sm text-ink-500 dark:text-ink-400">No active desks right now.</p>
                )}
                {dashboard.active_desks.map((d) => (
                  <div
                    key={d.desk_number}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-paper dark:bg-ink-900"
                  >
                    <div className="text-sm text-ink-700 dark:text-ink-300">
                      <strong className="text-ink-900 dark:text-white font-display">Desk {d.desk_number}</strong>
                      {d.operator_name && <span className="text-ink-400">{` · ${d.operator_name}`}</span>}
                      {` — ${d.registrations} registered`}
                    </div>
                    <button
                      onClick={() => handleForceRelease(d.desk_number)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-flare-500/10 text-flare-600 dark:text-flare-400 hover:bg-flare-500/20 transition"
                    >
                      Force Release
                    </button>
                  </div>
                ))}
                <p className="text-sm text-ink-500 dark:text-ink-400 pt-2 border-t border-ink-100 dark:border-ink-700">
                  Total registrations: <strong className="text-ink-900 dark:text-white font-display">{dashboard.total_registrations}</strong>
                </p>
              </section>

              <section className="bg-white dark:bg-ink-800 rounded-2xl p-5 flex flex-col gap-3 border border-ink-100 dark:border-ink-700">
                <h2 className="font-display font-semibold text-ink-900 dark:text-white">Export</h2>
                <button
                  onClick={handleExport}
                  className="py-2.5 rounded-xl bg-ink-900 dark:bg-marigold-500 text-white dark:text-ink-900 font-display font-semibold hover:opacity-90 active:scale-[0.99] transition"
                >
                  Download Excel (.xlsx)
                </button>
              </section>

              <section className="bg-white dark:bg-ink-800 rounded-2xl p-5 flex flex-col gap-3 border border-flare-500/30">
                <h2 className="font-display font-semibold text-flare-500">Danger Zone</h2>
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  Deletes all registrations, releases all desks, and removes the current banner. Export your data first.
                </p>
                <button
                  onClick={handleResetEvent}
                  className="py-2.5 rounded-xl bg-flare-500 text-white font-display font-semibold hover:bg-flare-600 transition"
                >
                  Reset Event
                </button>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
