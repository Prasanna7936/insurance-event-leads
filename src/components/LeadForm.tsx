import { useEffect, useMemo, useRef, useState } from 'react'
import { createLead, updateLead } from '../lib/api'
import { SMS_OTP_ENABLED } from '../lib/config'
import { LEAD_STATUSES, OCCUPATIONS } from '../lib/constants'
import { formatDateTime } from '../lib/format'
import { isValidIndianMobile, normalizeIndianMobile } from '../lib/mobile'
import type { Agent, Lead, LeadDraft, Occupation } from '../lib/types'
import { OtpPanel } from './OtpPanel'
import { PurposeSelect } from './MultiSelect'
import { Field, Spinner, useToast } from './ui'

const EMPTY_DRAFT: LeadDraft = {
  name: '',
  mobile: '',
  email: '',
  occupation: '',
  insurance_purpose: [],
  next_meeting_date: '',
  next_meeting_time: '',
  remarks: '',
  mobile_verified: false,
  lead_status: 'New',
  assigned_to: '',
}

function leadToDraft(lead: Lead): LeadDraft {
  return {
    id: lead.id,
    name: lead.name,
    mobile: lead.mobile.replace('+91', ''),
    email: lead.email ?? '',
    occupation: lead.occupation ?? '',
    insurance_purpose: lead.insurance_purpose,
    next_meeting_date: lead.next_meeting_date ?? '',
    next_meeting_time: (lead.next_meeting_time ?? '').slice(0, 5),
    remarks: lead.remarks ?? '',
    mobile_verified: lead.mobile_verified,
    lead_status: lead.lead_status,
    assigned_to: lead.assigned_to ?? '',
  }
}

interface Props {
  eventId: string
  eventName: string
  agents: Agent[]
  /** Agent row for the signed-in user, used as the default owner. */
  defaultAgentId?: string
  editing?: Lead | null
  onSaved: (lead: Lead, wasEdit: boolean) => void
  onCancel?: () => void
}

export function LeadForm({
  eventId,
  eventName,
  agents,
  defaultAgentId,
  editing = null,
  onSaved,
  onCancel,
}: Props) {
  const toast = useToast()
  const nameRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<LeadDraft>(() =>
    editing ? leadToDraft(editing) : { ...EMPTY_DRAFT, assigned_to: defaultAgentId ?? '' },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  /** Mobile the current verification belongs to; guards against later edits. */
  const [verifiedMobile, setVerifiedMobile] = useState<string | null>(
    editing?.mobile_verified ? editing.mobile : null,
  )

  useEffect(() => {
    setDraft(editing ? leadToDraft(editing) : { ...EMPTY_DRAFT, assigned_to: defaultAgentId ?? '' })
    setVerifiedMobile(editing?.mobile_verified ? editing.mobile : null)
    setErrors({})
  }, [editing, defaultAgentId])

  const normalizedMobile = normalizeIndianMobile(draft.mobile)

  // Verification only counts while the number it was issued for is unchanged.
  const isVerified = Boolean(
    draft.mobile_verified && verifiedMobile && verifiedMobile === normalizedMobile,
  )

  useEffect(() => {
    if (draft.mobile_verified && verifiedMobile && verifiedMobile !== normalizedMobile) {
      setDraft((d) => ({ ...d, mobile_verified: false }))
      setVerifiedMobile(null)
    }
  }, [normalizedMobile, draft.mobile_verified, verifiedMobile])

  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!draft.name.trim()) next.name = 'Name is required.'
    if (!draft.mobile.trim()) next.mobile = 'Mobile number is required.'
    else if (!isValidIndianMobile(draft.mobile))
      next.mobile = 'Enter a valid 10-digit Indian mobile number (starts with 6-9).'
    if (draft.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim()))
      next.email = 'Enter a valid email address.'
    if (draft.next_meeting_time && !draft.next_meeting_date)
      next.next_meeting_date = 'Pick a meeting date for this time.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(withVerification: boolean) {
    if (!validate() || !normalizedMobile) return
    setSaving(true)
    try {
      const payload: LeadDraft = { ...draft, mobile_verified: withVerification && isVerified }
      const saved = editing
        ? await updateLead(editing.id, payload, eventId, normalizedMobile)
        : await createLead(payload, eventId, normalizedMobile)

      toast(
        editing ? `Lead updated — ${saved.name}` : `Lead #${saved.serial_no} saved — ${saved.name}`,
        'success',
      )
      onSaved(saved, Boolean(editing))

      if (!editing) {
        setDraft({ ...EMPTY_DRAFT, assigned_to: defaultAgentId ?? '' })
        setVerifiedMobile(null)
        setErrors({})
        nameRef.current?.focus()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the lead.'
      toast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const activeAgents = useMemo(() => agents.filter((a) => a.active), [agents])

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(true)
      }}
    >
      <div className="card__head">
        <div>
          <h3 className="card__title">{editing ? `Edit Lead #${editing.serial_no}` : 'New Lead'}</h3>
          <div className="field__hint">{eventName}</div>
        </div>
        {editing && onCancel && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Cancel edit
          </button>
        )}
      </div>

      <div className="card__body">
        {/* -- Customer ------------------------------------------------------ */}
        <p className="section-label">Customer details</p>
        <div className="form-grid">
          <Field label="Name" required error={errors.name}>
            <input
              ref={nameRef}
              className={`input${errors.name ? ' input--error' : ''}`}
              value={draft.name}
              autoComplete="off"
              placeholder="Full name"
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field
            label="Mobile Number"
            required
            error={errors.mobile}
            hint="Indian mobile, 10 digits. Stored as +91XXXXXXXXXX."
          >
            <input
              className={`input${errors.mobile ? ' input--error' : ''}`}
              value={draft.mobile}
              inputMode="numeric"
              autoComplete="off"
              placeholder="98765 43210"
              disabled={SMS_OTP_ENABLED && isVerified}
              onChange={(e) => set('mobile', e.target.value.replace(/[^\d+\s-]/g, ''))}
            />
          </Field>

          <Field label="Email ID" error={errors.email}>
            <input
              className={`input${errors.email ? ' input--error' : ''}`}
              type="email"
              value={draft.email}
              autoComplete="off"
              placeholder="name@email.com"
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>

          <Field label="Occupation">
            <select
              className="select"
              value={draft.occupation}
              onChange={(e) => set('occupation', e.target.value as Occupation | '')}
            >
              <option value="">Select occupation…</option>
              {OCCUPATIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* -- Verification --------------------------------------------------
            Only rendered when SMS/OTP is switched on. With it off the form
            shows no verification UI at all, and leads save as unverified. */}
        {SMS_OTP_ENABLED && (
          <>
            <p className="section-label" style={{ marginTop: 22 }}>Mobile verification</p>
            <OtpPanel
              mobile={draft.mobile}
              verified={isVerified}
              onVerified={(mobile) => {
                setVerifiedMobile(mobile)
                set('mobile_verified', true)
              }}
              onReset={() => {
                setVerifiedMobile(null)
                set('mobile_verified', false)
              }}
              disabled={saving}
            />
            {editing?.mobile_verified && editing.mobile_verified_at && isVerified && (
              <div className="field__hint" style={{ marginTop: 6 }}>
                Verified on {formatDateTime(editing.mobile_verified_at)}
              </div>
            )}
          </>
        )}

        {/* -- Interest ------------------------------------------------------ */}
        <p className="section-label" style={{ marginTop: 22 }}>
          Insurance purpose <span style={{ textTransform: 'none', fontWeight: 500 }}>(select all that apply)</span>
        </p>
        <PurposeSelect
          value={draft.insurance_purpose}
          onChange={(next) => set('insurance_purpose', next)}
          disabled={saving}
        />

        {/* -- Follow-up ----------------------------------------------------- */}
        <p className="section-label" style={{ marginTop: 22 }}>Follow-up</p>
        <div className="form-grid">
          <Field label="Next Meeting Date" error={errors.next_meeting_date}>
            <input
              className={`input${errors.next_meeting_date ? ' input--error' : ''}`}
              type="date"
              value={draft.next_meeting_date}
              onChange={(e) => set('next_meeting_date', e.target.value)}
            />
          </Field>

          <Field label="Next Meeting Time">
            <input
              className="input"
              type="time"
              value={draft.next_meeting_time}
              onChange={(e) => set('next_meeting_time', e.target.value)}
            />
          </Field>

          <Field label="Lead Status">
            <select
              className="select"
              value={draft.lead_status}
              onChange={(e) => set('lead_status', e.target.value as LeadDraft['lead_status'])}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>

          <Field label="Assigned To">
            <select
              className="select"
              value={draft.assigned_to}
              onChange={(e) => set('assigned_to', e.target.value)}
            >
              <option value="">Unassigned</option>
              {activeAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Remarks" className="span-all">
            <textarea
              className="textarea"
              value={draft.remarks}
              placeholder="What did the customer ask for?"
              onChange={(e) => set('remarks', e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="modal__foot" style={{ justifyContent: 'space-between' }}>
        <span className="field__hint">
          {SMS_OTP_ENABLED
            ? isVerified
              ? '✓ Mobile verified — ready to submit.'
              : 'Verify the mobile number to submit as verified.'
            : ''}
        </span>
        <div className="btn-row">
          {onCancel && (
            <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          )}
          {SMS_OTP_ENABLED && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void submit(false)}
              disabled={saving}
              title="Stores the lead with Mobile Verified = No"
            >
              Save without verification
            </button>
          )}
          <button
            type="submit"
            className="btn btn--primary btn--lg"
            disabled={saving || (SMS_OTP_ENABLED && !isVerified)}
          >
            {saving ? <><Spinner /> Saving…</> : editing ? 'Update Lead' : 'Submit Lead'}
          </button>
        </div>
      </div>
    </form>
  )
}
