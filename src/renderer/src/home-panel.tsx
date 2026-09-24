import { ArrowRight, CalendarDays, CircleCheck, FileText, Inbox, Link2, MessageCircle, Plus, Sparkles } from 'lucide-react'
import type { Entity, WorkspaceSnapshot } from '../../shared/types'

type Destination = 'knowledge' | 'review' | 'documents' | 'calendar' | 'tasks'

interface Props {
  workspace: WorkspaceSnapshot
  onNavigate(destination: Destination): void
  onSelectEntity(entity: Entity): void
  onNewEntity(): void
  onAsk(): void
  onImport(): void
  onOpenEvent(id: string): void
  onOpenTask(id: string): void
}

export function HomePanel({ workspace, onNavigate, onSelectEntity, onNewEntity, onAsk, onImport, onOpenEvent, onOpenTask }: Props) {
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

  return <section className="home-page">
    <header className="home-header">
      <div>
        <span className="eyebrow">YOUR SPACE, IN CONTEXT</span>
        <h1>{greeting}<span className="home-period">.</span></h1>
        <p>A quieter place to connect what matters.</p>
      </div>
      <div className="home-date"><CalendarDays size={17}/>{date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
    </header>

    <div className="home-capture">
      <span className="home-capture-icon"><Sparkles size={20}/></span>
      <button onClick={onAsk}><strong>What’s on your mind?</strong><span>Ask a question, capture a thought, or make a connection</span></button>
      <span className="home-capture-arrow"><ArrowRight size={19}/></span>
    </div>

    <div className="home-metrics">
      <button onClick={() => onNavigate('knowledge')}><span className="metric-icon iris"><Link2 size={17}/></span><strong>{workspace.entities.length}</strong><small>Knowledge</small></button>
      <button onClick={() => onNavigate('review')}><span className="metric-icon amber"><Inbox size={17}/></span><strong>{pending.length}</strong><small>To review</small></button>
      <button onClick={() => workspace.modules.tasks && onNavigate('tasks')} disabled={!workspace.modules.tasks}><span className="metric-icon blue"><CircleCheck size={17}/></span><strong>{workspace.tasks.filter((task) => !task.completed).length}</strong><small>Open tasks</small></button>
      <button onClick={() => onNavigate('documents')}><span className="metric-icon violet"><FileText size={17}/></span><strong>{workspace.documents.length}</strong><small>Documents</small></button>
    </div>

    <div className="home-columns">
      <div className="home-stack">
        <section className="home-card">
          <div className="home-card-heading"><div><span className="eyebrow">AHEAD OF YOU</span><h2>Upcoming</h2></div>{(workspace.modules.tasks || workspace.modules.calendar) && <CalendarDays size={19}/>}</div>
          {upcoming.length ? <div className="home-list">{upcoming.map((item) => <button key={`${item.kind}-${item.id}`} onClick={() => item.kind === 'Task' ? onOpenTask(item.id) : onOpenEvent(item.id)}>
            <span className="home-list-date">{new Date(`${item.date.slice(0, 10)}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span className="home-list-body"><strong>{item.title}</strong><small>{item.kind}</small></span><ArrowRight size={15}/>
          </button>)}</div> : <div className="home-blank"><CalendarDays size={22}/><p>Nothing on the horizon yet.</p>{workspace.modules.calendar && <button onClick={() => onNavigate('calendar')}>Open calendar <ArrowRight size={14}/></button>}</div>}
        </section>

        <section className="home-card">
          <div className="home-card-heading"><div><span className="eyebrow">YOUR WORLD</span><h2>Knowledge</h2></div><button onClick={() => onNavigate('knowledge')} className="quiet-link">Browse all <ArrowRight size={15}/></button></div>
          {entities.length ? <div className="home-entity-grid">{entities.map((entity) => <button key={entity.id} onClick={() => onSelectEntity(entity)}>
            <span className="home-entity-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span><ArrowRight size={15}/>
          </button>)}</div> : <div className="home-blank"><Link2 size={22}/><p>Your knowledge starts with one meaningful thing.</p><button onClick={onNewEntity}>Create an entity <Plus size={14}/></button></div>}
        </section>
      </div>

      <div className="home-stack">
        <section className="home-card">
          <div className="home-card-heading"><div><span className="eyebrow">NEEDS YOUR EYES</span><h2>Review inbox</h2></div><span className="home-counter">{pending.length}</span></div>
          {pending.length ? <div className="home-review-list">{pending.slice(0, 3).map((proposal) => <button key={proposal.id} onClick={() => onNavigate('review')}>
            <span className="review-dot"/><span><strong>{proposal.kind === 'claim' ? `${proposal.key}: ${proposal.value}` : proposal.title}</strong><small>{proposal.kind} · {proposal.source}</small></span><ArrowRight size={15}/>
          </button>)}</div> : <div className="home-blank compact"><Inbox size={22}/><p>All caught up. New AI suggestions will appear here.</p></div>}
          {pending.length > 3 && <button className="home-card-footer" onClick={() => onNavigate('review')}>View all proposals <ArrowRight size={15}/></button>}
        </section>

        <section className="home-card">
          <div className="home-card-heading"><div><span className="eyebrow">THREADS BETWEEN THINGS</span><h2>Connections</h2></div><Link2 size={18}/></div>
          {connections.length ? <div className="home-connections">{connections.map((claim) => {
            const from = workspace.entities.find((entity) => entity.id === claim.subject)
            const to = workspace.entities.find((entity) => entity.id === claim.value)
            return from && to && <button key={claim.id} onClick={() => onSelectEntity(from)}><span>{from.title}</span><small>{claim.key}</small><span>{to.title}</span></button>
          })}</div> : <div className="home-blank compact"><Link2 size={22}/><p>Relationships will take shape as your knowledge grows.</p></div>}
        </section>

        <div className="home-quick-actions"><button onClick={onNewEntity}><Plus size={16}/> New knowledge</button><button onClick={onImport}><FileText size={16}/> Import a document</button><button onClick={onAsk}><MessageCircle size={16}/> Start a conversation</button></div>
      </div>
    </div>
  </section>
}
