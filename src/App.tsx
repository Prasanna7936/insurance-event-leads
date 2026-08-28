import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteLead, fetchAgents, fetchAllLeads, fetchEvents, fetchLeads } from './lib/api'
import { auth } from './lib/auth'
import type { AuthSession } from './lib/auth'
import { applyFilters } from './lib/filters'
import { DEMO_MODE } from './lib/config'
import { resetDemoData } from './lib/localStore'
import { supabase } from './lib/supabase'
import { EMPTY_FILTERS } from './lib/types'
import type { Agent, EventRecord, Lead, LeadFilters } from './lib/types'
import { Dashboard } from './components/Dashboard'
import { EventBar } from './components/EventBar'
import { LeadForm } from './components/LeadForm'
import { LeadTable } from './components/LeadTable'
import { Login } from './components/Login'
import { EmptyState, Spinner, ToastProvider, useToast } from './components/ui'

const EVENT_STORAGE_KEY = 'iel.selected_event_id'

type Tab = 'capture' | 'leads' | 'dashboard'

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  )
}

function Root() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    auth.getSession().then((current) => {
      if (cancelled) return
      setSession(current)
      setAuthReady(true)
    })
    const unsubscribe = auth.onChange(setSession)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (!authReady) return <div className="center-note"><Spinner dark /> Loading…</div>
  if (!session) return <Login onSignedIn={() => void auth.getSession().then(setSession)} />
  return <Workspace session={session} onSignOut={() => void auth.signOut()} />
}

function DemoBanner({ onReset }: { onReset: () => void }) {
  return (
    <div className="banner banner--warn">
      <strong>Demo mode — no database connected.</strong>{' '}
      Leads are kept in this browser only and are lost if you clear site data. SMS
      verification is off. To run for real, set <code>VITE_SUPABASE_URL</code> and{' '}
      <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> — see <code>README.md</code>.
      <button className="btn btn--link" style={{ marginLeft: 8 }} onClick={onReset}>
        Reset demo data
      </button>
    </div>
  )
}

function Workspace({ session, onSignOut }: { session: AuthSession; onSignOut: () => void }) {
  const toast = useToast()

  const [events, setEvents] = useState<EventRecord[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [eventId, setEventId] = useState<string>(
    () => localStorage.getItem(EVENT_STORAGE_KEY) ?? '',
  )
  const [tab, setTab] = useState<Tab>('capture')
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS)
  const [editing, setEditing] = useState<Lead | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [loadError, setLoadError] = useState('')

  // --- initial load ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [eventList, agentList] = await Promise.all([fetchEvents(), fetchAgents()])
        if (cancelled) return
        setEvents(eventList)
        setAgents(agentList)
        setEventId((current) => {
          if (current && eventList.some((e) => e.id === current)) return current
          return eventList.find((e) => e.status === 'active')?.id ?? eventList[0]?.id ?? ''
        })
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load data.')
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const refreshLeads = useCallback(
    async (id: string) => {
      if (!id) {
        setLeads([])
        return
      }
      setLoadingLeads(true)
      try {
        setLeads(await fetchLeads(id))
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not load leads.', 'error')
      } finally {
        setLoadingLeads(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    if (eventId) localStorage.setItem(EVENT_STORAGE_KEY, eventId)
    void refreshLeads(eventId)
    setFilters(EMPTY_FILTERS)
    setEditing(null)
  }, [eventId, refreshLeads])

  // --- keep several tablets on the same event in sync -----------------------
  useEffect(() => {
    if (!eventId || DEMO_MODE) return
    const channel = supabase
      .channel(`leads:${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads', filter: `event_id=eq.${eventId}` },
        () => { void refreshLeads(eventId) },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [eventId, refreshLeads])

  const currentEvent = events.find((e) => e.id === eventId) ?? null
  const eventName = currentEvent?.name ?? 'No event selected'
  // With the MVP admin login there is no Supabase user to match on, so fall
  // back to the first admin agent as the default owner for new leads.
  const myAgentId =
    agents.find((a) => a.auth_user_id === session.userId)?.id ??
    agents.find((a) => a.role === 'admin')?.id
  const visibleLeads = useMemo(() => applyFilters(leads, filters, agents), [leads, filters, agents])

  // --- actions --------------------------------------------------------------
  function handleSaved(lead: Lead, wasEdit: boolean) {
    setLeads((prev) =>
      wasEdit ? prev.map((l) => (l.id === lead.id ? lead : l)) : [...prev, lead],
    )
    if (wasEdit) {
      setEditing(null)
      setTab('leads')
    }
  }

  async function handleDelete(lead: Lead) {
    try {
      await deleteLead(lead.id)
      setLeads((prev) => prev.filter((l) => l.id !== lead.id))
      toast(`Deleted ${lead.name}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the lead.', 'error')
    }
  }

  async function handleExportAll() {
    setExporting(true)
    try {
      // xlsx is ~600 kB; it is only pulled in when someone actually exports.
      const [{ exportAllLeads }, all] = await Promise.all([
        import('./lib/excel'),
        fetchAllLeads(),
      ])
      if (all.length === 0) {
        toast('There are no leads to export yet.', 'info')
        return
      }
      exportAllLeads(all, agents, events)
      toast(`Exported ${all.length} lead(s) from all events.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleExportFiltered() {
    if (visibleLeads.length === 0) {
      toast('Nothing to export — no leads match the current filters.', 'info')
      return
    }
    setExporting(true)
    try {
      const { exportFilteredLeads } = await import('./lib/excel')
      exportFilteredLeads(visibleLeads, agents, events, eventName)
      toast(`Exported ${visibleLeads.length} filtered lead(s).`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setExporting(false)
    }
  }

  const initials = session.displayName.slice(0, 2).toUpperCase()

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__top">
          <div>
            <h1 className="masthead__title">Event Data Collection — Insurance Agent</h1>
            <div className="masthead__subtitle">
              Capture and manage leads collected during insurance events for effective follow-up and conversion.
            </div>
          </div>
          <div className="masthead__right">
            <EventBar
              events={events}
              selectedId={eventId}
              onSelect={setEventId}
              onCreated={(ev) => {
                setEvents((prev) => [ev, ...prev])
                setEventId(ev.id)
              }}
            />
            <span className="user-chip">
              <span className="avatar">{initials}</span>
              {session.displayName}
            </span>
            <button className="btn btn--ghost btn--sm" onClick={onSignOut}>
              Log out
            </button>
          </div>
        </div>

        <nav className="tabs">
          <button className={`tab${tab === 'capture' ? ' tab--active' : ''}`} onClick={() => setTab('capture')}>
            ➕ Capture Lead
          </button>
          <button className={`tab${tab === 'leads' ? ' tab--active' : ''}`} onClick={() => setTab('leads')}>
            📋 Leads <span className="tab__count">{leads.length}</span>
          </button>
          <button className={`tab${tab === 'dashboard' ? ' tab--active' : ''}`} onClick={() => setTab('dashboard')}>
            📊 Dashboard
          </button>
        </nav>
      </header>

      <main className="main">
        {DEMO_MODE && (
          <DemoBanner
            onReset={() => {
              resetDemoData()
              void refreshLeads(eventId)
              toast('Demo data reset to the sample event.', 'success')
            }}
          />
        )}
        {loadError && <div className="banner banner--error">{loadError}</div>}

        <div className="toolbar">
          <div className="toolbar__group">
            <strong style={{ color: 'var(--navy-900)' }}>{eventName}</strong>
            {currentEvent?.location && <span className="field__hint">{currentEvent.location}</span>}
          </div>
          <div className="toolbar__group">
            <button className="btn btn--success btn--lg" onClick={() => void handleExportAll()} disabled={exporting}>
              {exporting ? <><Spinner /> Preparing…</> : '⬇ Download All Leads — Excel'}
            </button>
            <button className="btn btn--ghost" onClick={() => void handleExportFiltered()} disabled={exporting}>
              Export Filtered Leads
            </button>
          </div>
        </div>

        {bootstrapping ? (
          <div className="center-note"><Spinner dark /> Loading your events…</div>
        ) : events.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="🎪"
              title="No events yet"
              hint="Create your first event to start collecting leads."
            />
          </div>
        ) : !eventId ? (
          <div className="card">
            <EmptyState icon="👆" title="Select an event to continue" />
          </div>
        ) : tab === 'capture' ? (
          <LeadForm
            eventId={eventId}
            eventName={eventName}
            agents={agents}
            defaultAgentId={myAgentId}
            editing={editing}
            onSaved={handleSaved}
            onCancel={editing ? () => setEditing(null) : undefined}
          />
        ) : tab === 'leads' ? (
          <LeadTable
            leads={visibleLeads}
            totalCount={leads.length}
            agents={agents}
            filters={filters}
            onFiltersChange={setFilters}
            onEdit={(lead) => { setEditing(lead); setTab('capture') }}
            onDelete={handleDelete}
            onAddFirst={() => setTab('capture')}
            loading={loadingLeads}
          />
        ) : (
          <Dashboard leads={leads} agents={agents} eventName={eventName} />
        )}
      </main>
    </div>
  )
}
