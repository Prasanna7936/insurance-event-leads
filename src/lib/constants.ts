import type { InsurancePurpose, LeadStatus, Occupation } from './types'

export const OCCUPATIONS: Occupation[] = [
  'Salaried',
  'Business Owner',
  'Self Employed',
  'Professional',
  'Government Employee',
  'Homemaker',
  'Student',
  'Retired',
  'Other',
]

export const INSURANCE_PURPOSES: InsurancePurpose[] = [
  'Pension / Annuity',
  'Savings',
  "Children's Education",
  'Kids Plan',
  'Family Health',
  'Wealth Creation',
  'Retirement Planning',
  'Life Protection',
  'Tax Planning',
  'Other',
]

export const LEAD_STATUSES: LeadStatus[] = [
  'New',
  'Contacted',
  'Interested',
  'Meeting Scheduled',
  'Proposal',
  'Converted',
  'Lost',
]

/** Chip colours for each lead status, keyed to the CSS custom properties. */
export const STATUS_TONE: Record<LeadStatus, string> = {
  'New': 'slate',
  'Contacted': 'blue',
  'Interested': 'violet',
  'Meeting Scheduled': 'amber',
  'Proposal': 'cyan',
  'Converted': 'green',
  'Lost': 'red',
}
