// -----------------------------------------------------------------------------
// Demo-mode store. Active ONLY when Supabase is not configured, so the app can
// be opened and clicked through before a project exists. Data lives in this
// browser's localStorage and goes no further — it is not the database.
// -----------------------------------------------------------------------------
import type { Agent, EventRecord, Lead, LeadDraft } from './types'

const KEY = 'iel.demo.v1'

interface Snapshot {
  events: EventRecord[]
  agents: Agent[]
  leads: Lead[]
}

const now = () => new Date().toISOString()
const uid = () => `demo-${Math.random().toString(36).slice(2, 10)}`

function seed(): Snapshot {
  const agents: Agent[] = [
    { id: 'agent-ravi', auth_user_id: 'demo-user', name: 'Ravi Sharma', email: 'ravi.sharma@example.com', phone: null, role: 'admin', active: true, created_at: now() },
    { id: 'agent-neha', auth_user_id: null, name: 'Neha Gupta', email: 'neha.gupta@example.com', phone: null, role: 'agent', active: true, created_at: now() },
    { id: 'agent-amit', auth_user_id: null, name: 'Amit Verma', email: 'amit.verma@example.com', phone: null, role: 'agent', active: true, created_at: now() },
  ]

  const events: EventRecord[] = [
    { id: 'event-blr', name: 'Insurance Awareness Event - Bangalore - September 2026', location: 'Bangalore', start_date: '2026-09-05', end_date: '2026-09-07', status: 'active', notes: null, created_at: now() },
  ]

  // The five rows from the reference sheet, so every screen has something in it.
  const sample: Array<Partial<Lead> & { name: string; mobile: string }> = [
    { name: 'Arun Kumar', mobile: '+919876543210', email: 'arun.kumar@email.com', occupation: 'Salaried', insurance_purpose: ['Retirement Planning', 'Tax Planning'], next_meeting_date: '2026-09-05', next_meeting_time: '11:00', remarks: 'Interested in retirement plan', mobile_verified: true, lead_status: 'Interested', assigned_to: 'agent-ravi' },
    { name: 'Priya Mehta', mobile: '+919823456789', email: 'priya.mehta@email.com', occupation: 'Business Owner', insurance_purpose: ['Wealth Creation', 'Tax Planning'], next_meeting_date: '2026-09-06', next_meeting_time: '16:00', remarks: 'Wants to compare plans', mobile_verified: true, lead_status: 'Meeting Scheduled', assigned_to: 'agent-neha' },
    { name: 'Sandeep Singh', mobile: '+919898765432', email: 'sandeep.singh@email.com', occupation: 'Self Employed', insurance_purpose: ['Family Health', 'Savings'], next_meeting_date: '2026-09-07', next_meeting_time: '10:30', remarks: 'Looking for family health cover', mobile_verified: false, lead_status: 'New', assigned_to: 'agent-amit' },
    { name: 'Anjali Reddy', mobile: '+919123456780', email: 'anjali.reddy@email.com', occupation: 'Professional', insurance_purpose: ["Children's Education", 'Savings'], next_meeting_date: '2026-09-08', next_meeting_time: '15:00', remarks: "For daughter's education", mobile_verified: true, lead_status: 'Contacted', assigned_to: 'agent-neha' },
    { name: 'Rajesh Iyer', mobile: '+919765432109', email: 'rajesh.iyer@email.com', occupation: 'Government Employee', insurance_purpose: ['Pension / Annuity', 'Retirement Planning'], next_meeting_date: '2026-09-09', next_meeting_time: '12:00', remarks: 'Wants pension options', mobile_verified: true, lead_status: 'New', assigned_to: 'agent-ravi' },
  ]

  const leads: Lead[] = sample.map((s, i) => ({
    id: uid(),
    event_id: 'event-blr',
    serial_no: i + 1,
    name: s.name,
    mobile: s.mobile,
    email: s.email ?? null,
    occupation: s.occupation ?? null,
    insurance_purpose: s.insurance_purpose ?? [],
    next_meeting_date: s.next_meeting_date ?? null,
    next_meeting_time: s.next_meeting_time ?? null,
    remarks: s.remarks ?? null,
    mobile_verified: s.mobile_verified ?? false,
    mobile_verified_at: s.mobile_verified ? now() : null,
    verification_method: s.mobile_verified ? 'whatsapp_manual' : null,
    lead_status: s.lead_status ?? 'New',
    assigned_to: s.assigned_to ?? null,
    created_by: 'demo-user',
    created_at: now(),
    updated_at: now(),
  }))

  return { events, agents, leads }
}

function read(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Snapshot
  } catch {
    // corrupt or unavailable storage — fall through and reseed
  }
  const fresh = seed()
  write(fresh)
  return fresh
}

function write(snapshot: Snapshot) {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot))
  } catch {
    // private browsing / quota — the session still works, it just will not persist
  }
}

export function resetDemoData() {
  write(seed())
}

// --- the same surface as api.ts ----------------------------------------------

export async function fetchEvents(): Promise<EventRecord[]> {
  return read().events
}

export async function createEvent(input: Partial<EventRecord> & { name: string }): Promise<EventRecord> {
  const snap = read()
  const event: EventRecord = {
    id: uid(),
    name: input.name,
    location: input.location ?? null,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    status: input.status ?? 'active',
    notes: input.notes ?? null,
    created_at: now(),
  }
  snap.events = [event, ...snap.events]
  write(snap)
  return event
}

export async function fetchAgents(): Promise<Agent[]> {
  return read().agents.filter((a) => a.active)
}

export async function fetchLeads(eventId: string): Promise<Lead[]> {
  return read()
    .leads.filter((l) => l.event_id === eventId)
    .sort((a, b) => a.serial_no - b.serial_no)
}

export async function fetchAllLeads(): Promise<Lead[]> {
  return read().leads
}

function fromDraft(draft: LeadDraft, eventId: string, mobile: string): Omit<Lead, 'id' | 'serial_no' | 'created_at'> {
  return {
    event_id: eventId,
    name: draft.name.trim(),
    mobile,
    email: draft.email.trim() || null,
    occupation: draft.occupation || null,
    insurance_purpose: draft.insurance_purpose,
    next_meeting_date: draft.next_meeting_date || null,
    next_meeting_time: draft.next_meeting_time || null,
    remarks: draft.remarks.trim() || null,
    mobile_verified: draft.mobile_verified,
    mobile_verified_at: draft.mobile_verified ? now() : null,
    verification_method: draft.mobile_verified ? draft.verification_method || 'whatsapp_manual' : null,
    lead_status: draft.lead_status,
    assigned_to: draft.assigned_to || null,
    created_by: 'demo-user',
    updated_at: now(),
  }
}

export async function createLead(draft: LeadDraft, eventId: string, mobile: string): Promise<Lead> {
  const snap = read()
  if (snap.leads.some((l) => l.event_id === eventId && l.mobile === mobile)) {
    throw new Error('A lead with this mobile number already exists for this event.')
  }
  const serial =
    Math.max(0, ...snap.leads.filter((l) => l.event_id === eventId).map((l) => l.serial_no)) + 1
  const lead: Lead = { ...fromDraft(draft, eventId, mobile), id: uid(), serial_no: serial, created_at: now() }
  snap.leads.push(lead)
  write(snap)
  return lead
}

export async function updateLead(id: string, draft: LeadDraft, eventId: string, mobile: string): Promise<Lead> {
  const snap = read()
  const existing = snap.leads.find((l) => l.id === id)
  if (!existing) throw new Error('Lead not found.')
  if (snap.leads.some((l) => l.id !== id && l.event_id === eventId && l.mobile === mobile)) {
    throw new Error('A lead with this mobile number already exists for this event.')
  }
  const updated: Lead = {
    ...existing,
    ...fromDraft(draft, eventId, mobile),
    id: existing.id,
    serial_no: existing.serial_no,
    created_at: existing.created_at,
    mobile_verified_at: draft.mobile_verified
      ? (existing.mobile_verified && existing.mobile === mobile ? existing.mobile_verified_at : now())
      : null,
  }
  snap.leads = snap.leads.map((l) => (l.id === id ? updated : l))
  write(snap)
  return updated
}

export async function deleteLead(id: string): Promise<void> {
  const snap = read()
  snap.leads = snap.leads.filter((l) => l.id !== id)
  write(snap)
}
