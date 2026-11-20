import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readWorkbook, guessMapping, exportAttendanceToExcel } from '../utils/prereg'
import { Download, FileSpreadsheet, Trash2, Upload, UserCheck } from 'lucide-react'

const BATCH = 250
const POLL_MS = 15000

const card = 'bg-cream dark:bg-ink-800 rounded-2xl p-5 flex flex-col gap-4 border border-ink-100 dark:border-ink-700'
const primaryBtn =
  'py-2.5 rounded-xl bg-marigold-500 dark:bg-marigold-400 text-white dark:text-ink-950 font-display font-semibold hover:opacity-90 active:scale-[0.99] transition disabled:opacity-50'

function MappingTable({ columns, nameCols, phoneCols, onChange }) {
  function toggle(list, col) {
    return list.includes(col) ? list.filter((c) => c !== col) : columns.filter((c) => list.includes(c) || c === col)
  }
  return (
    <div className="rounded-xl border border-ink-100 dark:border-ink-700 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 bg-paper dark:bg-ink-900 text-xs font-medium text-ink-500 dark:text-ink-400">
        <span>Column in your sheet</span>
        <span className="w-12 text-center">Name</span>
        <span className="w-12 text-center">Phone</span>
      </div>
      {columns.map((col) => (
        <label
          key={col}
          className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center px-3 py-2 border-t border-ink-100 dark:border-ink-700 text-sm text-ink-700 dark:text-ink-100"
        >
          <span className="truncate" title={col}>
            {col}
          </span>
          <span className="w-12 flex justify-center">
            <input
              type="checkbox"
              aria-label={`Search ${col} as a name`}
              checked={nameCols.includes(col)}
              onChange={() => onChange({ nameCols: toggle(nameCols, col), phoneCols })}
            />
          </span>
          <span className="w-12 flex justify-center">
            <input
              type="checkbox"
              aria-label={`Search ${col} as a phone number`}
              checked={phoneCols.includes(col)}
              onChange={() => onChange({ nameCols, phoneCols: toggle(phoneCols, col) })}
            />
          </span>
        </label>
      ))}
    </div>
  )
}

export default function PreregPanel({ adminCode, eventName, flash }) {
  const [summary, setSummary] = useState(null)
  const [sheets, setSheets] = useState(null) // parsed workbook, before upload
  const [sheetIdx, setSheetIdx] = useState(0)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState({ nameCols: [], phoneCols: [] })
  const [replace, setReplace] = useState(true)
  const [progress, setProgress] = useState(null) // { done, total }
  const [reading, setReading] = useState(false)
  const [savedMapping, setSavedMapping] = useState(null) // editing mapping of the stored list
  const fileRef = useRef(null)
  const flashRef = useRef(flash)
  flashRef.current = flash

  const loadSummary = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_prereg_summary', { p_admin_code: adminCode })
    if (error) {
      if ((error.message || '').includes('admin_get_prereg_summary')) {
        flashRef.current('Run supabase/update_5_preregistration.sql in Supabase first.')
      }
      return
    }
    setSummary(data)
  }, [adminCode])

  useEffect(() => {
    loadSummary()
    const t = setInterval(loadSummary, POLL_MS)
    return () => clearInterval(t)
  }, [loadSummary])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setReading(true)
    try {
      const parsed = await readWorkbook(file)
      if (parsed.length === 0) {
        flash('No rows found in that file.')
        return
      }
      setSheets(parsed)
      setSheetIdx(0)
      setFileName(file.name)
      setMapping(guessMapping(parsed[0].columns, parsed[0].rows))
      setReplace(true)
    } catch (err) {
      flash('Could not read that file: ' + (err.message || 'unknown error'))
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function pickSheet(i) {
    setSheetIdx(i)
    setMapping(guessMapping(sheets[i].columns, sheets[i].rows))
  }

  async function handleUpload() {
    const sheet = sheets[sheetIdx]
    if (mapping.nameCols.length === 0 && mapping.phoneCols.length === 0) {
      return flash('Tick at least one Name or Phone column so desks can search.')
    }
    if (replace && summary?.attended > 0) {
      const ok = confirm(
        `${summary.attended} people are already checked in. Replacing the list clears those check-ins. Download the attendance first if you need it. Continue?`
      )
      if (!ok) return
    }

    const total = sheet.rows.length
    setProgress({ done: 0, total })
    for (let start = 0; start < total; start += BATCH) {
      const chunk = sheet.rows.slice(start, start + BATCH)
      const { error } = await supabase.rpc('admin_import_preregistrations', {
        p_admin_code: adminCode,
        p_rows: chunk,
        p_replace: replace && start === 0,
        p_columns: sheet.columns,
        p_name_cols: mapping.nameCols,
        p_phone_cols: mapping.phoneCols,
        p_file_name: fileName,
        p_start_row: (replace ? 0 : summary?.total || 0) + start + 1,
      })
      if (error) {
        setProgress(null)
        flash(`Upload stopped after ${start} rows: ${error.message}. Upload again with "Replace" ticked.`)
        loadSummary()
        return
      }
      setProgress({ done: Math.min(total, start + BATCH), total })
    }
    setProgress(null)
    setSheets(null)
    flash(`${total} people uploaded. Desks can search them now.`)
    loadSummary()
  }

  async function handleExport() {
    const { data, error } = await supabase.rpc('admin_get_preregistrations', { p_admin_code: adminCode })
    if (error) return flash('Failed to fetch the list.')
    if (!data?.rows?.length) return flash('The list is empty.')
    exportAttendanceToExcel(data, eventName)
  }

  async function handleClear() {
    if (!confirm('Remove the uploaded list and all check-in marks? New registrations are not affected.')) return
    const { error } = await supabase.rpc('admin_clear_preregistrations', { p_admin_code: adminCode })
    if (error) return flash('Failed to remove the list.')
    flash('List removed. Desks go straight to the registration form.')
    loadSummary()
  }

  async function handleSaveMapping() {
    const { error } = await supabase.rpc('admin_update_prereg_mapping', {
      p_admin_code: adminCode,
      p_name_cols: savedMapping.nameCols,
      p_phone_cols: savedMapping.phoneCols,
    })
    if (error) return flash('Failed to save search columns.')
    setSavedMapping(null)
    flash('Search columns updated.')
    loadSummary()
  }

  const hasList = summary?.total > 0
  const sheet = sheets?.[sheetIdx]
  const pct = hasList ? Math.round((summary.attended / summary.total) * 100) : 0

  return (
    <>
      {hasList && (
        <section className={card}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-ink-900 dark:text-white">Check-in progress</h2>
              <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                {summary.file_name || 'Uploaded list'}
                {summary.uploaded_at && ` · uploaded ${new Date(summary.uploaded_at).toLocaleString()}`}
              </p>
            </div>
            <UserCheck className="text-marigold-500 dark:text-marigold-400 shrink-0" size={20} />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Checked in', `${summary.attended}`],
              ['Not yet', `${summary.total - summary.attended}`],
              ['New walk-ins', `${summary.walk_ins}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-paper dark:bg-ink-900 py-3">
                <div className="font-display font-semibold text-2xl text-ink-900 dark:text-white">{value}</div>
                <div className="text-xs text-ink-500 dark:text-ink-400">{label}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="h-2 rounded-full bg-ink-100 dark:bg-ink-700 overflow-hidden">
              <div className="h-full bg-marigold-500 dark:bg-marigold-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-ink-500 dark:text-ink-400 mt-1.5">
              {pct}% of {summary.total} pre-registered
              {summary.no_phone > 0 && ` · ${summary.no_phone} with no phone number (search by name)`}
            </p>
          </div>

          {summary.recent?.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-400 dark:text-ink-500">Latest check-ins</span>
              {summary.recent.map((r) => (
                <div key={r.id} className="flex justify-between gap-3 text-sm py-1 border-b border-ink-100 dark:border-ink-700 last:border-0">
                  <span className="truncate text-ink-800 dark:text-ink-100">
                    {(summary.name_cols?.[0] && r.data[summary.name_cols[0]]) || 'No name'}
                  </span>
                  <span className="shrink-0 text-ink-500 dark:text-ink-400 text-xs">
                    {new Date(r.attended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Desk {r.attended_desk}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={handleExport} className={`${primaryBtn} flex-1 flex items-center justify-center gap-2 px-4`}>
              <Download size={16} /> Download attendance (.xlsx)
            </button>
            <button
              onClick={() => setSavedMapping(savedMapping ? null : { nameCols: summary.name_cols || [], phoneCols: summary.phone_cols || [] })}
              className="px-4 py-2.5 rounded-xl border border-ink-200 dark:border-ink-600 text-sm text-ink-700 dark:text-ink-200 hover:bg-ink-50 dark:hover:bg-ink-700 transition"
            >
              Search columns
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-2.5 rounded-xl text-sm bg-flare-500/10 text-flare-600 dark:text-flare-400 hover:bg-flare-500/20 transition flex items-center gap-1.5"
            >
              <Trash2 size={14} /> Remove list
            </button>
          </div>

          {savedMapping && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-500 dark:text-ink-400">Desks search these columns. Changes apply straight away, no re-upload needed.</p>
              <MappingTable columns={summary.columns || []} nameCols={savedMapping.nameCols} phoneCols={savedMapping.phoneCols} onChange={setSavedMapping} />
              <button onClick={handleSaveMapping} className={primaryBtn}>
                Save search columns
              </button>
            </div>
          )}
        </section>
      )}

      <section className={card}>
        <div>
          <h2 className="font-display font-semibold text-ink-900 dark:text-white">{hasList ? 'Upload a new list' : 'Pre-registered list'}</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
            Upload your Google Form / Excel export as it is (.xlsx, .xls or .csv). Desks search it by mobile number or name: people on the
            list just get marked present, everyone else fills in the registration form.
          </p>
        </div>

        {!sheet && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="flex items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed border-ink-200 dark:border-ink-600 text-sm text-ink-600 dark:text-ink-300 hover:border-marigold-500 transition disabled:opacity-50"
          >
            <Upload size={16} /> {reading ? 'Reading file…' : 'Choose Excel file'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="hidden"
          onChange={handleFile}
        />

        {sheet && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-xl bg-paper dark:bg-ink-900 px-3 py-2.5">
              <FileSpreadsheet className="text-marigold-500 dark:text-marigold-400 shrink-0" size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink-900 dark:text-white truncate">{fileName}</div>
                <div className="text-xs text-ink-500 dark:text-ink-400">
                  {sheet.rows.length} people · {sheet.columns.length} columns
                </div>
              </div>
              {sheets.length > 1 && (
                <select
                  value={sheetIdx}
                  onChange={(e) => pickSheet(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg border border-ink-100 dark:border-ink-600 bg-cream dark:bg-ink-800 text-ink-900 dark:text-white text-sm"
                >
                  {sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.rows.length})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink-700 dark:text-ink-100">Which columns should desks search?</span>
              <span className="text-xs text-ink-500 dark:text-ink-400">
                Ticked automatically from your headers. The first Name column is shown as the person's name.
              </span>
              <MappingTable columns={sheet.columns} nameCols={mapping.nameCols} phoneCols={mapping.phoneCols} onChange={setMapping} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-700 dark:text-ink-100">Preview</span>
              <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-700">
                <table className="text-xs min-w-full">
                  <thead className="bg-paper dark:bg-ink-900 text-ink-500 dark:text-ink-400">
                    <tr>
                      {sheet.columns.map((c) => (
                        <th key={c} className="text-left font-medium px-2.5 py-2 whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-ink-800 dark:text-ink-100">
                    {sheet.rows.slice(0, 3).map((r, i) => (
                      <tr key={i} className="border-t border-ink-100 dark:border-ink-700">
                        {sheet.columns.map((c) => (
                          <td key={c} className="px-2.5 py-2 whitespace-nowrap max-w-[220px] truncate">
                            {r[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {hasList && (
              <div className="flex flex-col gap-1.5 text-sm text-ink-700 dark:text-ink-100">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={replace} onChange={() => setReplace(true)} />
                  Replace the current list ({summary.total} people)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!replace} onChange={() => setReplace(false)} />
                  Add these to the current list (late sign-ups)
                </label>
              </div>
            )}

            {progress ? (
              <div className="flex flex-col gap-1.5">
                <div className="h-2 rounded-full bg-ink-100 dark:bg-ink-700 overflow-hidden">
                  <div
                    className="h-full bg-marigold-500 dark:bg-marigold-400 transition-all"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-ink-500 dark:text-ink-400">
                  Uploading {progress.done} / {progress.total}…
                </span>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={handleUpload} className={`${primaryBtn} flex-1`}>
                  Upload {sheet.rows.length} people
                </button>
                <button
                  onClick={() => setSheets(null)}
                  className="px-4 py-2.5 rounded-xl border border-ink-200 dark:border-ink-600 text-sm text-ink-700 dark:text-ink-200 hover:bg-ink-50 dark:hover:bg-ink-700 transition"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  )
}
