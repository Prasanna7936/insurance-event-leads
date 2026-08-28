import { DEMO_MODE } from './config'
import * as local from './localStore'
import { functionsBaseUrl, supabase } from './supabase'
import type { Agent, EventRecord, Lead, LeadDraft } from './types'

// -----------------------------------------------------------------------------
// Edge function calls (OTP)
// -----------------------------------------------------------------------------

export interface SendOtpResponse {
  success: true
  mobile: string
  expiresAt: string
  expiresInSeconds: number
  resendAfterSeconds: number
  maxAttempts: number
  /** present only while OTP_DEV_MODE is on and MSG91 is unconfigured */
  devOtp?: string
}

export interface VerifyOtpResponse {
  verified: boolean
  mobile?: string
  verifiedAt?: string
  attemptsRemaining?: number
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Your session expired. Please sign in again.')

  let res: Response
  try {
    res = await fetch(`${functionsBaseUrl}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Network error. Check the tablet’s connection and retry.')
  }

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(payload?.error ?? `Request failed (${res.status})`)
    Object.assign(err, payload)
    throw err
  }
  return payload as T
}

export const sendOtp = (mobile: string) => callFunction<SendOtpResponse>('send-otp', { mobile })

export const verifyOtp = (mobile: string, otp: string) =>
  callFunction<VerifyOtpResponse>('verify-otp', { mobile, otp })

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

async function sbFetchEvents(): Promise<EventRecord[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('start_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

async function sbCreateEvent(
  input: Pick<EventRecord, 'name'> & Partial<EventRecord>,
): Promise<EventRecord> {
  const { data: sessionData } = await supabase.auth.getSession()
  const { data, error } = await supabase
    .from('events')
    .insert({
      name: input.name,
      location: input.location ?? null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      status: input.status ?? 'active',
      notes: input.notes ?? null,
      created_by: sessionData.session?.user.id ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

// -----------------------------------------------------------------------------
// Agents
// -----------------------------------------------------------------------------

async function sbFetchAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

// -----------------------------------------------------------------------------
// Leads
// -----------------------------------------------------------------------------

async function sbFetchLeads(eventId: string): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('event_id', eventId)
    .order('serial_no', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Every lead in the database, across all events — used by the full export. */
async function sbFetchAllLeads(): Promise<Lead[]> {
  const pageSize = 1000
  const all: Lead[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return all
}

function draftToRow(draft: LeadDraft, eventId: string, mobile: string) {
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
    verification_method: draft.mobile_verified ? draft.verification_method || null : null,
    lead_status: draft.lead_status,
    assigned_to: draft.assigned_to || null,
  }
}

/** Turns Postgres errors into something an agent at a desk can act on. */
/** True when Postgres/PostgREST is telling us the column is not there yet. */
function isMissingVerificationMethod(message: string): boolean {
  return message.includes('verification_method')
}

/** Drops verification_method so a save still works before the migration is run. */
function withoutVerificationMethod<T extends Record<string, unknown>>(row: T) {
  const { verification_method: _omitted, ...rest } = row
  return rest
}

function humanizeLeadError(message: string): string {
  if (message.includes('leads_event_mobile_key')) {
    return 'A lead with this mobile number already exists for this event.'
  }
  if (message.includes('cannot be marked verified')) {
    return 'Mobile verification has expired. Send a fresh OTP and verify again.'
  }
  if (message.includes('leads_mobile_check')) {
    return 'Mobile number must be a valid Indian number.'
  }
  if (message.includes('leads_email_check')) return 'Enter a valid email address.'
  return message
}

async function sbCreateLead(draft: LeadDraft, eventId: string, mobile: string): Promise<Lead> {
  const { data: sessionData } = await supabase.auth.getSession()
  const row = { ...draftToRow(draft, eventId, mobile), created_by: sessionData.session?.user.id ?? null }

  const { data, error } = await supabase.from('leads').insert(row).select('*').single()

  if (error && isMissingVerificationMethod(error.message)) {
    console.warn(
      'leads.verification_method is missing — run supabase/setup.sql. Saving without it.',
    )
    const retry = await supabase.from('leads').insert(withoutVerificationMethod(row)).select('*').single()
    if (retry.error) throw new Error(humanizeLeadError(retry.error.message))
    return retry.data
  }

  if (error) throw new Error(humanizeLeadError(error.message))
  return data
}

async function sbUpdateLead(
  id: string,
  draft: LeadDraft,
  eventId: string,
  mobile: string,
): Promise<Lead> {
  const row = draftToRow(draft, eventId, mobile)

  const { data, error } = await supabase.from('leads').update(row).eq('id', id).select('*').single()

  if (error && isMissingVerificationMethod(error.message)) {
    console.warn(
      'leads.verification_method is missing — run supabase/setup.sql. Saving without it.',
    )
    const retry = await supabase
      .from('leads')
      .update(withoutVerificationMethod(row))
      .eq('id', id)
      .select('*')
      .single()
    if (retry.error) throw new Error(humanizeLeadError(retry.error.message))
    return retry.data
  }

  if (error) throw new Error(humanizeLeadError(error.message))
  return data
}

async function sbDeleteLead(id: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// -----------------------------------------------------------------------------
// Demo mode routes every read and write to the in-browser store instead of
// Postgres. It is only ever on when Supabase is unconfigured.
// -----------------------------------------------------------------------------
export const fetchEvents = DEMO_MODE ? local.fetchEvents : sbFetchEvents
export const createEvent = DEMO_MODE ? local.createEvent : sbCreateEvent
export const fetchAgents = DEMO_MODE ? local.fetchAgents : sbFetchAgents
export const fetchLeads = DEMO_MODE ? local.fetchLeads : sbFetchLeads
export const fetchAllLeads = DEMO_MODE ? local.fetchAllLeads : sbFetchAllLeads
export const createLead = DEMO_MODE ? local.createLead : sbCreateLead
export const updateLead = DEMO_MODE ? local.updateLead : sbUpdateLead
export const deleteLead = DEMO_MODE ? local.deleteLead : sbDeleteLead
