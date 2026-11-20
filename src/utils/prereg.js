import * as XLSX from 'xlsx'

// ---------------------------------------------------------------------------
// Pre-registration list helpers: read the uploaded sheet exactly as it is,
// guess which columns hold names / phone numbers, and pick what the desk
// shows on each match card.
// ---------------------------------------------------------------------------

function cellToText(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return ''
    return v.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  }
  if (typeof v === 'number') {
    // Integers (phone numbers stored as numbers) keep every digit, no 5.3E+08.
    return Number.isInteger(v) ? v.toFixed(0) : String(v)
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v).replace(/\s+/g, ' ').trim()
}

function uniqueHeaders(rawHeaders) {
  const seen = {}
  return rawHeaders.map((h, i) => {
    let name = cellToText(h) || `Column ${i + 1}`
    if (seen[name]) {
      seen[name] += 1
      name = `${name} (${seen[name]})`
    } else {
      seen[name] = 1
    }
    return name
  })
}

/** Reads every sheet of an .xlsx / .xls / .csv file. */
export async function readWorkbook(file) {
  const buf = await file.arrayBuffer()
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv'
  // For CSV, keep cells as typed text so leading zeros survive.
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: isCsv })
  return wb.SheetNames.map((name) => ({ name, ...parseSheet(wb.Sheets[name]) })).filter((s) => s.rows.length > 0)
}

function parseSheet(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false })
  // Header = first row with at least two filled cells (skips title rows).
  const headerIdx = aoa.findIndex((r) => r.filter((c) => cellToText(c) !== '').length >= 2)
  if (headerIdx === -1) return { columns: [], rows: [] }

  const raw = aoa[headerIdx]
  const width = Math.max(raw.length, ...aoa.slice(headerIdx + 1).map((r) => r.length))
  const padded = Array.from({ length: width }, (_, i) => raw[i] ?? '')
  const allColumns = uniqueHeaders(padded)

  const rows = []
  for (const r of aoa.slice(headerIdx + 1)) {
    const obj = {}
    let filled = false
    allColumns.forEach((col, i) => {
      const t = cellToText(r[i])
      obj[col] = t
      if (t) filled = true
    })
    if (filled) rows.push(obj)
  }

  // Drop columns that have neither a real header nor any data.
  const columns = allColumns.filter((col, i) => cellToText(padded[i]) !== '' || rows.some((r) => r[col]))
  const trimmed = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])))
  return { columns, rows: trimmed }
}

const NAME_RE = /name/i
const NOT_NAME_RE = /school|institution|company|organi[sz]ation|event|file|user ?name|e-?mail|team|class/i
const PHONE_RE = /mobile|phone|whats\s?app|contact|tel\b|cell|number|\bno\.?\b/i
const NOT_PHONE_RE = /name|\bage\b|grade|class|roll|\bid\b|admission|seat|ticket|email/i

function looksLikePhone(value) {
  return value.replace(/\D/g, '').length >= 7
}

/** Best guess at which columns hold names and phone numbers. */
export function guessMapping(columns, rows) {
  const sample = rows.slice(0, 200)
  const phoneShare = (col) => {
    const vals = sample.map((r) => r[col]).filter(Boolean)
    if (vals.length === 0) return 0
    return vals.filter(looksLikePhone).length / vals.length
  }

  const nameCols = columns.filter((c) => NAME_RE.test(c) && !NOT_NAME_RE.test(c))
  let phoneCols = columns.filter((c) => PHONE_RE.test(c) && !NOT_PHONE_RE.test(c))
  if (phoneCols.length === 0) phoneCols = columns.filter((c) => phoneShare(c) >= 0.8)

  // Fall back to the first text-looking column for names.
  if (nameCols.length === 0) {
    const first = columns.find((c) => !/time|date/i.test(c) && phoneShare(c) < 0.5)
    if (first) nameCols.push(first)
  }
  return { nameCols, phoneCols }
}

const HIDDEN_ON_CARD_RE = /^(timestamp|time ?stamp|submitted|submission|date)/i

/** Splits a matched row into what the desk card shows. */
export function describeRow(data, prereg) {
  const columns = prereg?.columns?.length ? prereg.columns : Object.keys(data || {})
  const nameCols = prereg?.name_cols || []
  const phoneCols = prereg?.phone_cols || []
  const title = (nameCols[0] && data[nameCols[0]]) || data[columns[0]] || 'No name'

  const phones = []
  for (const c of phoneCols) {
    const v = data[c]
    if (v && looksLikePhone(v) && !phones.some((p) => p.value === v)) phones.push({ label: c, value: v })
  }

  const details = columns
    .filter((c) => c !== nameCols[0] && !phoneCols.includes(c) && !HIDDEN_ON_CARD_RE.test(c))
    .map((c) => ({ label: c, value: data[c] }))
    .filter((d) => d.value)

  const all = columns.map((c) => ({ label: c, value: data[c] })).filter((d) => d.value)
  return { title, phones, details, all }
}

/** Downloads the list with attendance columns added. */
export function exportAttendanceToExcel({ columns, rows }, eventName) {
  const header = [...columns, 'Attended', 'Check-in time', 'Desk', 'Checked in by']
  const body = rows.map((r) => [
    ...columns.map((c) => r.data?.[c] ?? ''),
    r.attended_at ? 'Yes' : 'No',
    r.attended_at ? new Date(r.attended_at).toLocaleString() : '',
    r.attended_desk ?? '',
    r.attended_operator ?? '',
  ])
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = header.map(() => ({ wch: 18 }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
  const safeName = (eventName || 'Event').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  XLSX.writeFile(wb, `${safeName}_Attendance_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
