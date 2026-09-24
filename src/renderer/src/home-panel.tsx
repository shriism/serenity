import { ArrowRight, CalendarDays, FileText, Link2, Plus } from 'lucide-react'
import type { Entity, WorkspaceSnapshot } from '../../shared/types'

type Destination = 'knowledge' | 'review' | 'documents' | 'calendar' | 'tasks'

interface Props {
  workspace: WorkspaceSnapshot
  onNavigate(destination: Destination): void
  onSelectEntity(entity: Entity): void
  onNewEntity(): void
  onImport(): void
  onOpenEvent(id: string): void
  onOpenTask(id: string): void
}

export function HomePanel({ workspace, onNavigate, onSelectEntity, onNewEntity, onImport, onOpenEvent, onOpenTask }: Props) {
  const date = new Date()
  const today = date.toLocaleDateString('en-CA')
  const greeting = date.getHours() < 12 ? 'Good morning' : date.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const upcoming = [
    ...(workspace.modules.tasks ? workspace.tasks.filter((task) => !task.completed && task.due && task.due >= today)
      .map((task) => ({ id: task.id, title: task.title, date: task.due!, kind: 'Task' })) : []),
    ...(workspace.modules.calendar ? workspace.events.filter((event) => event.start.slice(0, 10) >= today)
      .map((event) => ({ id: event.id, title: event.title, date: event.start, kind: 'Event' })) : [])
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
  const pending = workspace.proposals.filter((item) => item.status === 'pending')
  const entities = [...workspace.entities].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 5)
  const connections = workspace.claims.filter((claim) => claim.status === 'confirmed' &&
    workspace.entities.some((entity) => entity.id === claim.value)).slice(0, 3)

  return <section className="home-page quiet-home">
    <header className="home-header">
      <div><span className="home-date">{date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <h1>{greeting}<span className="home-period">.</span></h1>
        <p>Your space to think, remember, and connect.</p>
      </div>
    </header>

    <div className="home-columns">
      <div className="home-stack">
        <section className="home-card">
          <div className="home-card-heading"><h2>Upcoming</h2>{upcoming.length > 0 && <span className="section-count">{upcoming.length}</span>}</div>
          {upcoming.length ? <div className="home-list">{upcoming.map((item) => <button key={`${item.kind}-${item.id}`} onClick={() => item.kind === 'Task' ? onOpenTask(item.id) : onOpenEvent(item.id)}>
            <span className="home-list-date">{new Date(`${item.date.slice(0, 10)}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span className="home-list-body"><strong>{item.title}</strong><small>{item.kind}</small></span><ArrowRight size={15}/>
          </button>)}</div> : <p className="home-inline-empty">Nothing coming up. {workspace.modules.calendar && <button onClick={() => onNavigate('calendar')}>Open calendar <ArrowRight size={13}/></button>}</p>}
        </section>

        <section className="home-card">
          <div className="home-card-heading"><h2>Knowledge</h2><button onClick={() => onNavigate('knowledge')} className="quiet-link">Browse all <ArrowRight size={14}/></button></div>
          {entities.length ? <div className="home-entity-grid">{entities.map((entity) => <button key={entity.id} onClick={() => onSelectEntity(entity)}>
            <span className="home-entity-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span><ArrowRight size={15}/>
          </button>)}</div> : <p className="home-inline-empty">Start with a person, project, or idea. <button onClick={onNewEntity}>Create an entity <Plus size={13}/></button></p>}
        </section>
      </div>

      <div className="home-stack">
        <section className="home-card">
          <div className="home-card-heading"><h2>For your review</h2>{pending.length > 0 && <span className="section-count">{pending.length}</span>}</div>
          {pending.length ? <div className="home-review-list">{pending.slice(0, 3).map((proposal) => <button key={proposal.id} onClick={() => onNavigate('review')}>
            <span><strong>{proposal.kind === 'claim' ? `${proposal.key}: ${proposal.value}` : proposal.title}</strong><small>{proposal.kind} · {proposal.source}</small></span><ArrowRight size={15}/>
          </button>)}</div> : <p className="home-inline-empty">You’re all caught up.</p>}
          {pending.length > 3 && <button className="home-card-footer" onClick={() => onNavigate('review')}>View all proposals <ArrowRight size={14}/></button>}
        </section>

        {connections.length > 0 && <section className="home-card">
          <div className="home-card-heading"><h2>Connections</h2><Link2 size={15}/></div>
          <div className="home-connections">{connections.map((claim) => {
            const from = workspace.entities.find((entity) => entity.id === claim.subject)
            const to = workspace.entities.find((entity) => entity.id === claim.value)
            return from && to && <button key={claim.id} onClick={() => onSelectEntity(from)}><span>{from.title}</span><small>{claim.key}</small><span>{to.title}</span></button>
          })}</div>
        </section>}

        <div className="home-shortcuts">{entities.length > 0 && <button onClick={onNewEntity}><Plus size={15}/> New entity</button>}<button onClick={onImport}><FileText size={15}/> Import document</button></div>
      </div>
    </div>
  </section>
}
