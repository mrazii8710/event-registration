import * as XLSX from 'xlsx'

/**
 * Builds and downloads an .xlsx file where columns dynamically match
 * the event's currently configured questions, in order, plus
 * Reg #, Desk #, Operator, and Timestamp.
 *
 * A "group" question (e.g. repeatable "Student" entries) expands into
 * N columns per sub-field, where N is the highest number of instances
 * seen across all registrations — e.g. "Student 1 Name", "Student 1 Age",
 * "Student 2 Name", "Student 2 Age", etc.
 *
 * @param {Array<{id:number, desk_number:number, operator_name:string, answers:object, created_at:string}>} registrations
 * @param {Array<object>} questions
 * @param {string} eventName
 */
export function exportRegistrationsToExcel(registrations, questions, eventName) {
  // Work out, for each group question, the max number of instances
  // actually used across all registrations.
  const groupMaxCounts = {}
  for (const q of questions) {
    if (q.type !== 'group') continue
    let max = 1
    for (const r of registrations) {
      const arr = r.answers?.[q.key]
      if (Array.isArray(arr)) max = Math.max(max, arr.length)
    }
    groupMaxCounts[q.key] = max
  }

  const header = ['Reg #', 'Desk #', 'Operator']
  for (const q of questions) {
    if (q.type === 'group') {
      const count = groupMaxCounts[q.key]
      const itemLabel = q.group?.item_label || 'Entry'
      for (let i = 1; i <= count; i++) {
        for (const f of q.group.fields) {
          header.push(`${itemLabel} ${i} ${f.label}`)
        }
      }
    } else {
      header.push(q.label)
    }
  }
  header.push('Timestamp')

  const rows = registrations.map((r) => {
    const row = [r.id, r.desk_number, r.operator_name || '']
    for (const q of questions) {
      if (q.type === 'group') {
        const count = groupMaxCounts[q.key]
        const arr = Array.isArray(r.answers?.[q.key]) ? r.answers[q.key] : []
        for (let i = 0; i < count; i++) {
          const instance = arr[i] || {}
          for (const f of q.group.fields) {
            row.push(instance[f.key] ?? '')
          }
        }
      } else {
        row.push(r.answers?.[q.key] ?? '')
      }
    }
    row.push(new Date(r.created_at).toLocaleString())
    return row
  })

  const worksheetData = [header, ...rows]
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

  worksheet['!cols'] = header.map((h, i) => {
    if (i === 0 || i === 1) return { wch: 10 }
    if (i === 2) return { wch: 16 }
    if (i === header.length - 1) return { wch: 20 }
    return { wch: 18 }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Registrations')

  const safeName = (eventName || 'Event').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  const dateStr = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${safeName}_Registrations_${dateStr}.xlsx`)
}
