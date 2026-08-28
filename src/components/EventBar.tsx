import { useState } from 'react'
import { createEvent } from '../lib/api'
import { formatDate } from '../lib/format'
import type { EventRecord } from '../lib/types'
import { Field, Modal, Spinner, useToast } from './ui'

export function EventBar({
  events,
  selectedId,
  onSelect,
  onCreated,
}: {
  events: EventRecord[]
  selectedId: string
  onSelect: (id: string) => void
  onCreated: (event: EventRecord) => void
}) {
  const [showNew, setShowNew] = useState(false)

  return (
    <>
      <div className="toolbar__group">
        <label className="field__label" htmlFor="event-select" style={{ margin: 0 }}>Event</label>
        <select
          id="event-select"
          className="select"
          style={{ minWidth: 280, maxWidth: 420 }}
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
        >
          {events.length === 0 && <option value="">No events yet</option>}
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
              {ev.location ? ` — ${ev.location}` : ''}
              {ev.start_date ? ` (${formatDate(ev.start_date)})` : ''}
              {ev.status !== 'active' ? ` [${ev.status}]` : ''}
            </option>
          ))}
        </select>
        <button className="btn btn--ghost btn--sm" onClick={() => setShowNew(true)}>+ New event</button>
      </div>

      {showNew && (
        <NewEventModal
          onClose={() => setShowNew(false)}
          onCreated={(ev) => {
            onCreated(ev)
            setShowNew(false)
          }}
        />
      )}
    </>
  )
}

function NewEventModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (event: EventRecord) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) {
      setError('Event name is required.')
      return
    }
    setSaving(true)
    try {
      const ev = await createEvent({
        name: name.trim(),
        location: location.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
      })
      toast(`Event created — ${ev.name}`, 'success')
      onCreated(ev)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the event.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="New event"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? <><Spinner /> Creating…</> : 'Create event'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Event name" required error={error} className="span-all">
          <input
            className={`input${error ? ' input--error' : ''}`}
            value={name}
            placeholder="Insurance Awareness Event — Bangalore — September 2026"
            onChange={(e) => { setName(e.target.value); setError('') }}
          />
        </Field>
        <Field label="Location" className="span-all">
          <input
            className="input"
            value={location}
            placeholder="Bangalore"
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>
        <Field label="Start date">
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="End date">
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
