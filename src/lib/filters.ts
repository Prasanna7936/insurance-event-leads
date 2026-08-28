import type { Agent, Lead, LeadFilters } from './types'

/** Applies search + every filter + the chosen sort, in one pass over the leads. */
export function applyFilters(leads: Lead[], filters: LeadFilters, agents: Agent[]): Lead[] {
  const agentName = new Map(agents.map((a) => [a.id, a.name.toLowerCase()]))
  const q = filters.search.trim().toLowerCase()

  const result = leads.filter((lead) => {
    if (q) {
      const haystack = [
        lead.name,
        lead.mobile,
        lead.email ?? '',
        lead.remarks ?? '',
        lead.occupation ?? '',
        lead.lead_status,
        lead.insurance_purpose.join(' '),
        lead.assigned_to ? (agentName.get(lead.assigned_to) ?? '') : '',
        String(lead.serial_no),
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }

    if (filters.occupation && lead.occupation !== filters.occupation) return false
    if (filters.purpose && !lead.insurance_purpose.includes(filters.purpose as never)) return false
    if (filters.status && lead.lead_status !== filters.status) return false
    if (filters.verified === 'yes' && !lead.mobile_verified) return false
    if (filters.verified === 'no' && lead.mobile_verified) return false
    if (filters.assignedTo) {
      if (filters.assignedTo === 'unassigned') {
        if (lead.assigned_to) return false
      } else if (lead.assigned_to !== filters.assignedTo) return false
    }
    return true
  })

  const byMeeting = (lead: Lead) =>
    lead.next_meeting_date ? `${lead.next_meeting_date}T${lead.next_meeting_time ?? '00:00'}` : ''

  result.sort((a, b) => {
    switch (filters.sort) {
      case 'oldest':
        return a.created_at.localeCompare(b.created_at)
      case 'meeting_asc': {
        // Leads with no meeting scheduled sink to the bottom.
        const av = byMeeting(a)
        const bv = byMeeting(b)
        if (!av) return bv ? 1 : 0
        if (!bv) return -1
        return av.localeCompare(bv)
      }
      case 'meeting_desc': {
        const av = byMeeting(a)
        const bv = byMeeting(b)
        if (!av) return bv ? 1 : 0
        if (!bv) return -1
        return bv.localeCompare(av)
      }
      case 'name_asc':
        return a.name.localeCompare(b.name)
      case 'newest':
      default:
        return b.created_at.localeCompare(a.created_at)
    }
  })

  return result
}
