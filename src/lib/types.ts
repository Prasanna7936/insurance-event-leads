export type Occupation =
  | 'Salaried'
  | 'Business Owner'
  | 'Self Employed'
  | 'Professional'
  | 'Government Employee'
  | 'Homemaker'
  | 'Student'
  | 'Retired'
  | 'Other'

export type InsurancePurpose =
  | 'Pension / Annuity'
  | 'Savings'
  | "Children's Education"
  | 'Kids Plan'
  | 'Family Health'
  | 'Wealth Creation'
  | 'Retirement Planning'
  | 'Life Protection'
  | 'Tax Planning'
  | 'Other'

export type VerificationMethod = 'otp' | 'whatsapp_manual'

export type LeadStatus =
  | 'New'
  | 'Contacted'
  | 'Interested'
  | 'Meeting Scheduled'
  | 'Proposal'
  | 'Converted'
  | 'Lost'

export interface Agent {
  id: string
  auth_user_id: string | null
  name: string
  email: string | null
  phone: string | null
  role: 'agent' | 'admin'
  active: boolean
  created_at: string
}

export interface EventRecord {
  id: string
  name: string
  location: string | null
  start_date: string | null
  end_date: string | null
  status: 'active' | 'completed' | 'archived'
  notes: string | null
  created_at: string
}

export interface Lead {
  id: string
  event_id: string
  serial_no: number
  name: string
  mobile: string
  email: string | null
  occupation: Occupation | null
  insurance_purpose: InsurancePurpose[]
  next_meeting_date: string | null
  next_meeting_time: string | null
  remarks: string | null
  mobile_verified: boolean
  mobile_verified_at: string | null
  verification_method: VerificationMethod | null
  lead_status: LeadStatus
  assigned_to: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Everything the form collects; `id` present means we are editing. */
export interface LeadDraft {
  id?: string
  name: string
  mobile: string
  email: string
  occupation: Occupation | ''
  insurance_purpose: InsurancePurpose[]
  next_meeting_date: string
  next_meeting_time: string
  remarks: string
  mobile_verified: boolean
  verification_method: VerificationMethod | ''
  lead_status: LeadStatus
  assigned_to: string
}

export interface LeadFilters {
  search: string
  occupation: string
  purpose: string
  status: string
  verified: '' | 'yes' | 'no'
  assignedTo: string
  sort: 'newest' | 'oldest' | 'meeting_asc' | 'meeting_desc' | 'name_asc'
}

export const EMPTY_FILTERS: LeadFilters = {
  search: '',
  occupation: '',
  purpose: '',
  status: '',
  verified: '',
  assignedTo: '',
  sort: 'newest',
}
