import { useState } from 'react'
import { INSURANCE_PURPOSES, LEAD_STATUSES, OCCUPATIONS, STATUS_TONE } from '../lib/constants'
import { formatDate, formatTime } from '../lib/format'
import { displayMobile } from '../lib/mobile'
import { EMPTY_FILTERS } from '../lib/types'
import type { Agent, Lead, LeadFilters } from '../lib/types'
import { EmptyState, Modal } from './ui'

interface Props {
  leads: Lead[]
  totalCount: number
  agents: Agent[]
  filters: LeadFilters
  onFiltersChange: (next: LeadFilters) => void
  onEdit: (lead: Lead) => void
  onDelete: (lead: Lead) => Promise<void>
  onAddFirst: () => void
  loading: boolean
}

export function LeadTable({
  leads,
  totalCount,
  agents,
  filters,
  onFiltersChange,
  onEdit,
  onDelete,
  onAddFirst,
  loading,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<Lead | null>(null)
  const [deleting, setDeleting] = useState(false)

  const set = <K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value })

  const filtersActive =
    filters.search !== '' ||
    filters.occupation !== '' ||
    filters.purpose !== '' ||
    filters.status !== '' ||
    filters.verified !== '' ||
    filters.assignedTo !== ''

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? ''

  return (
    <div className="card">
      {/* --- filters ------------------------------------------------------- */}
      <div className="filters">
        <div className="search" style={{ gridColumn: 'span 2' }}>
          <span className="search__icon">🔍</span>
          <input
            className="input"
            placeholder="Search name, mobile, email, remarks…"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </div>

        <select className="select" value={filters.occupation} onChange={(e) => set('occupation', e.target.value)}>
          <option value="">All occupations</option>
          {OCCUPATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>

        <select className="select" value={filters.purpose} onChange={(e) => set('purpose', e.target.value)}>
          <option value="">All purposes</option>
          {INSURANCE_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <select className="select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          className="select"
          value={filters.verified}
          onChange={(e) => set('verified', e.target.value as LeadFilters['verified'])}
        >
          <option value="">Verified: any</option>
          <option value="yes">Verified: Yes</option>
          <option value="no">Verified: No</option>
        </select>

        <select className="select" value={filters.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}>
          <option value="">All agents</option>
          <option value="unassigned">Unassigned</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select
          className="select"
          value={filters.sort}
          onChange={(e) => set('sort', e.target.value as LeadFilters['sort'])}
        >
          <option value="newest">Sort: Newest first</option>
          <option value="oldest">Sort: Oldest first</option>
          <option value="meeting_asc">Sort: Meeting date ↑</option>
          <option value="meeting_desc">Sort: Meeting date ↓</option>
          <option value="name_asc">Sort: Name A-Z</option>
        </select>
      </div>

      <div className="filter-summary">
        <span>
          Showing <strong>{leads.length}</strong> of <strong>{totalCount}</strong> leads in this event
          {loading && ' · refreshing…'}
        </span>
        {filtersActive && (
          <button
            className="btn btn--link"
            onClick={() => onFiltersChange({ ...EMPTY_FILTERS, sort: filters.sort })}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* --- table --------------------------------------------------------- */}
      {leads.length === 0 ? (
        totalCount === 0 ? (
          <EmptyState
            icon="🧾"
            title="No leads captured yet"
            hint="Every lead you capture at this event will appear here."
            action={<button className="btn btn--primary" onClick={onAddFirst}>+ Capture first lead</button>}
          />
        ) : (
          <EmptyState icon="🔍" title="No leads match these filters" hint="Try clearing a filter or the search box." />
        )
      ) : (
        <div className="table-scroll">
          <table className="lead-table">
            <thead>
              <tr>
                <th className="th--idx">Sl. No.</th>
                <th className="th--person">Name</th>
                <th className="th--person">Mobile No.</th>
                <th className="th--person">Email ID</th>
                <th className="th--profile">Occupation</th>
                <th className="th--profile">Insurance Purpose</th>
                <th className="th--meeting">Next Meeting Date</th>
                <th className="th--meeting">Next Meeting Time</th>
                <th className="th--remarks">Remarks</th>
                <th className="th--verify">Mobile Verified</th>
                <th className="th--status">Lead Status</th>
                <th className="th--status">Assigned To</th>
                <th className="th--verify">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td className="cell--idx">{lead.serial_no}</td>
                  <td className="cell--name">{lead.name}</td>
                  <td className="cell--mobile">{displayMobile(lead.mobile)}</td>
                  <td className="cell--email">{lead.email ?? '—'}</td>
                  <td>{lead.occupation ?? '—'}</td>
                  <td>
                    {lead.insurance_purpose.length === 0 ? (
                      '—'
                    ) : (
                      <div className="purpose-list">
                        {lead.insurance_purpose.map((p) => (
                          <span key={p} className="purpose-tag">{p}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="cell--nowrap">{formatDate(lead.next_meeting_date) || '—'}</td>
                  <td className="cell--nowrap">{formatTime(lead.next_meeting_time) || '—'}</td>
                  <td className="cell--remarks">{lead.remarks ?? '—'}</td>
                  <td>
                    <span className={`yesno yesno--${lead.mobile_verified ? 'yes' : 'no'}`}>
                      {lead.mobile_verified ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>
                    <span className="status-pill" data-tone={STATUS_TONE[lead.lead_status]}>
                      {lead.lead_status}
                    </span>
                  </td>
                  <td>{agentName(lead.assigned_to) || '—'}</td>
                  <td className="cell--actions">
                    <button className="icon-btn" title="Edit lead" onClick={() => onEdit(lead)}>✎</button>
                    <button
                      className="icon-btn icon-btn--danger"
                      title="Delete lead"
                      onClick={() => setPendingDelete(lead)}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <Modal
          title="Delete lead?"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn btn--danger"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  try {
                    await onDelete(pendingDelete)
                    setPendingDelete(null)
                  } finally {
                    setDeleting(false)
                  }
                }}
              >
                {deleting ? 'Deleting…' : 'Delete lead'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            <strong>{pendingDelete.name}</strong> ({displayMobile(pendingDelete.mobile)}) will be
            permanently removed from this event. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}
