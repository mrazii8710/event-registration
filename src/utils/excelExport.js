import * as XLSX from 'xlsx'

/**
 * Builds and downloads an .xlsx file where columns dynamically match
 * the event's currently configured questions, in order, plus
 * Reg #, Desk #, and Timestamp.
 *
 * @param {Array<{id:number, desk_number:number, answers:object, created_at:string}>} registrations
 * @param {Array<{key:string, label:string}>} questions
 * @param {string} eventName
 */
export function exportRegistrationsToExcel(registrations, questions, eventName) {
  const header = ['Reg #', 'Desk #', ...questions.map((q) => q.label), 'Timestamp']

  const rows = registrations.map((r) => {
    const row = [r.id, r.desk_number]
    for (const q of questions) {
      row.push(r.answers?.[q.key] ?? '')
    }
    row.push(new Date(r.created_at).toLocaleString())
    return row
  })

  const worksheetData = [header, ...rows]
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

  // Reasonable column widths
  worksheet['!cols'] = header.map((h, i) => {
    if (i === 0 || i === 1) return { wch: 10 }
    if (i === header.length - 1) return { wch: 20 }
    return { wch: 18 }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Registrations')

  const safeName = (eventName || 'Event').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  const dateStr = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${safeName}_Registrations_${dateStr}.xlsx`)
}
