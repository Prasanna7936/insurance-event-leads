import { useMemo } from 'react'
import { INSURANCE_PURPOSES, LEAD_STATUSES, STATUS_TONE } from '../lib/constants'
import { formatDate, formatTime, todayISO } from '../lib/format'
import { displayMobile } from '../lib/mobile'
import type { Agent, Lead, LeadStatus } from '../lib/types'
import { EmptyState } from './ui'

/**
 * Status tiles kept off the dashboard. The counts are still computed and the
 * lead table's column, filter and Excel export are untouched — this only
 * controls which cards appear in the Event summary grid.
 */
const HIDDEN_STAT_CARDS: LeadStatus[] = ['Contacted']

export function Dashboard({
  leads,
  agents,
  eventName,
}: {
  leads: Lead[]
  agents: Agent[]
  eventName: string
}) {
  const stats = useMemo(() => {
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<string, number>
    let verified = 0
    for (const lead of leads) {
      byStatus[lead.lead_status] = (byStatus[lead.lead_status] ?? 0) + 1
      if (lead.mobile_verified) verified++
    }
    return { total: leads.length, verified, unverified: leads.length - verified, byStatus }
  }, [leads])

  const byPurpose = useMemo(() => {
    const counts = new Map<string, number>()
    for (const lead of leads) {
      for (const p of lead.insurance_purpose) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    return INSURANCE_PURPOSES.map((p) => ({ purpose: p, count: counts.get(p) ?? 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [leads])

  const upcoming = useMemo(() => {
    const today = todayISO()
    return leads
      .filter((l) => l.next_meeting_date && l.next_meeting_date >= today)
      .sort((a, b) => {
        const byDate = (a.next_meeting_date ?? '').localeCompare(b.next_meeting_date ?? '')
        if (byDate !== 0) return byDate
        return (a.next_meeting_time ?? '').localeCompare(b.next_meeting_time ?? '')
      })
      .slice(0, 12)
  }, [leads])

  const maxPurpose = Math.max(1, ...byPurpose.map((r) => r.count))
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? 'Unassigned'

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h3 className="card__title">Event summary</h3>
          <span className="field__hint">{eventName}</span>
        </div>
        <div className="card__body">
          <div className="stat-grid">
            <Stat label="Total Leads" value={stats.total} tone="blue" />
            {LEAD_STATUSES.filter((status) => !HIDDEN_STAT_CARDS.includes(status)).map((status) => (
              <Stat
                key={status}
                label={status === 'Meeting Scheduled' ? 'Meetings Scheduled' : status}
                value={stats.byStatus[status] ?? 0}
                tone={STATUS_TONE[status]}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card__head">
            <h3 className="card__title">Leads by Insurance Purpose</h3>
          </div>
          <div className="card__body">
            {byPurpose.length === 0 ? (
              <EmptyState icon="📊" title="No purposes recorded yet" />
            ) : (
              byPurpose.map((row) => (
                <div className="bar-row" key={row.purpose}>
                  <div className="bar-row__head">
                    <span className="bar-row__name">{row.purpose}</span>
                    <span>
                      {row.count} ({Math.round((row.count / Math.max(stats.total, 1)) * 100)}%)
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(row.count / maxPurpose) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h3 className="card__title">Upcoming Meetings</h3>
            <span className="field__hint">{upcoming.length} scheduled from today</span>
          </div>
          <div className="card__body">
            {upcoming.length === 0 ? (
              <EmptyState icon="📅" title="No upcoming meetings" hint="Schedule a next meeting while capturing a lead." />
            ) : (
              upcoming.map((lead) => (
                <div className="meeting-item" key={lead.id}>
                  <div className="meeting-date">
                    {formatDate(lead.next_meeting_date)}
                    <br />
                    {formatTime(lead.next_meeting_time) || '—'}
                  </div>
                  <div className="meeting-body">
                    <div className="meeting-name">{lead.name}</div>
                    <div className="meeting-meta">
                      {displayMobile(lead.mobile)} · {agentName(lead.assigned_to)}
                    </div>
                    {lead.insurance_purpose.length > 0 && (
                      <div className="purpose-list" style={{ marginTop: 5 }}>
                        {lead.insurance_purpose.slice(0, 3).map((p) => (
                          <span className="purpose-tag" key={p}>{p}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="status-pill" data-tone={STATUS_TONE[lead.lead_status]}>
                    {lead.lead_status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="stat" data-tone={tone}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}
