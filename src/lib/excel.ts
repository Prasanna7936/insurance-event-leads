import * as XLSX from 'xlsx'
import { formatDate, formatDateTime, formatTime, todayISO } from './format'
import type { Agent, EventRecord, Lead } from './types'

/** Column order mirrors the on-screen lead table exactly. */
const COLUMNS = [
  'Sl. No.',
  'Name',
  'Mobile No.',
  'Email ID',
  'Occupation',
  'Insurance Purpose',
  'Next Meeting Date',
  'Next Meeting Time',
  'Remarks',
  'Mobile Verified',
  'Lead Status',
  'Assigned To',
] as const

const COLUMN_WIDTHS = [7, 22, 16, 28, 20, 34, 18, 18, 30, 15, 18, 18]

interface RowContext {
  agents: Agent[]
  events: EventRecord[]
  includeEventColumn: boolean
}

function toRow(lead: Lead, ctx: RowContext, index: number) {
  const agent = ctx.agents.find((a) => a.id === lead.assigned_to)
  const row: Record<string, string | number> = {
    'Sl. No.': ctx.includeEventColumn ? index + 1 : lead.serial_no,
    'Name': lead.name,
    'Mobile No.': lead.mobile,
    'Email ID': lead.email ?? '',
    'Occupation': lead.occupation ?? '',
    'Insurance Purpose': lead.insurance_purpose.join(', '),
    'Next Meeting Date': formatDate(lead.next_meeting_date),
    'Next Meeting Time': formatTime(lead.next_meeting_time),
    'Remarks': lead.remarks ?? '',
    'Mobile Verified': lead.mobile_verified ? 'Yes' : 'No',
    'Lead Status': lead.lead_status,
    'Assigned To': agent?.name ?? '',
  }

  if (ctx.includeEventColumn) {
    // Only on the all-events export, where the event is otherwise ambiguous.
    row['Event'] = ctx.events.find((e) => e.id === lead.event_id)?.name ?? ''
    row['Verified At'] = formatDateTime(lead.mobile_verified_at)
    row['Captured At'] = formatDateTime(lead.created_at)
  }

  return row
}

function buildWorkbook(leads: Lead[], ctx: RowContext, sheetName: string) {
  const header = ctx.includeEventColumn
    ? [...COLUMNS, 'Event', 'Verified At', 'Captured At']
    : [...COLUMNS]

  const rows = leads.map((lead, i) => toRow(lead, ctx, i))
  const sheet = XLSX.utils.json_to_sheet(rows, { header: header as string[] })

  sheet['!cols'] = header.map((_, i) => ({ wch: COLUMN_WIDTHS[i] ?? 20 }))
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(rows.length, 1), c: header.length - 1 },
    }),
  }
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 }

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31))
  return book
}

function download(book: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(book, filename, { compression: true })
}

/** Every lead in the database, across every event. */
export function exportAllLeads(leads: Lead[], agents: Agent[], events: EventRecord[]) {
  const book = buildWorkbook(
    leads,
    { agents, events, includeEventColumn: true },
    'All Leads',
  )
  download(book, `Insurance_Event_Leads_${todayISO()}.xlsx`)
}

/** Exactly what the table currently shows, in the same order. */
export function exportFilteredLeads(
  leads: Lead[],
  agents: Agent[],
  events: EventRecord[],
  eventName: string,
) {
  const book = buildWorkbook(
    leads,
    { agents, events, includeEventColumn: false },
    eventName || 'Filtered Leads',
  )
  download(book, `Insurance_Event_Leads_Filtered_${todayISO()}.xlsx`)
}
