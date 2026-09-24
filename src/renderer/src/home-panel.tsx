import { ArrowRight, ArrowUpRight, FileText, Plus } from 'lucide-react'
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
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
  const pending = workspace.proposals.filter((item) => item.status === 'pending')
  const recentClaims = workspace.claims.filter((claim) => claim.status === 'confirmed')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 3)
  const focusEntity = workspace.entities.find((entity) => entity.id === recentClaims[0]?.subject) ?? workspace.entities[0]
  const connections = workspace.claims.filter((claim) => claim.status === 'confirmed' &&
    workspace.entities.some((entity) => entity.id === claim.value)).slice(0, 2)
  const readable = (value: string): string => value.replace(/[*_`~]/g, '').replace(/^#+\s*/gm, '').trim()

  return <section className="home-page studio-home" aria-label="Workspace home">
    <header className="home-intro">
      <time dateTime={today}>{date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</time>
      <h1>{greeting}<span className="home-period">.</span></h1>
    </header>

    <section className="home-focus" aria-label="Current focus">
      <span className="home-kicker">In focus</span>
      {focusEntity ? <><button className="home-focus-title" onClick={() => onSelectEntity(focusEntity)}>{focusEntity.title}<ArrowUpRight size={23}/></button>
        <p>{focusEntity.type} · {workspace.claims.filter((claim) => claim.subject === focusEntity.id && claim.status === 'confirmed').length} sourced {workspace.claims.filter((claim) => claim.subject === focusEntity.id && claim.status === 'confirmed').length === 1 ? 'detail' : 'details'} in your knowledge.</p></>
        : pending.length ? <><button className="home-focus-title" onClick={() => onNavigate('review')}>{pending[0].kind === 'claim' ? `${pending[0].key}: ${pending[0].value}` : pending[0].title}<ArrowUpRight size={23}/></button><p>A suggestion is waiting for your decision.</p></>
          : <><h2>Start with what matters to you.</h2><p>A person, an idea, or a project is enough to begin.</p><button className="home-focus-action" onClick={onNewEntity}>Create your first entity <ArrowRight size={16}/></button></>}
    </section>

    <div className="home-threads">
      <div className="home-thread-primary">
        <section className="home-thread">
          <div className="home-thread-heading"><h2>Coming up</h2>{upcoming.length > 0 && <button onClick={() => onNavigate(workspace.modules.calendar ? 'calendar' : 'tasks')}>See all <ArrowRight size={14}/></button>}</div>
          {upcoming.length ? <div className="home-list">{upcoming.map((item) => <button key={`${item.kind}-${item.id}`} onClick={() => item.kind === 'Task' ? onOpenTask(item.id) : onOpenEvent(item.id)}>
            <span className="home-list-date">{new Date(`${item.date.slice(0, 10)}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span className="home-list-body"><strong>{item.title}</strong><small>{item.kind}</small></span><ArrowUpRight size={15}/>
          </button>)}</div> : <p className="home-thread-empty">Nothing planned in the days ahead.</p>}
        </section>

        <section className="home-thread">
          <div className="home-thread-heading"><h2>Recent changes</h2><button onClick={() => onNavigate('knowledge')}>Your knowledge <ArrowRight size={14}/></button></div>
          {recentClaims.length ? <div className="home-recent-list">{recentClaims.map((claim) => {
            const entity = workspace.entities.find((item) => item.id === claim.subject)
            return entity && <button key={claim.id} onClick={() => onSelectEntity(entity)}><span><strong>{entity.title}</strong><small>{claim.key}: {readable(workspace.entities.find((item) => item.id === claim.value)?.title ?? claim.value)}</small></span><ArrowUpRight size={15}/></button>
          })}</div> : <p className="home-thread-empty">The things you learn and connect will appear here.</p>}
        </section>
      </div>

      <div className="home-thread-secondary">
        <section className="home-thread">
          <div className="home-thread-heading"><h2>Worth a look</h2>{pending.length > 0 && <span className="home-pending-count">{pending.length}</span>}</div>
          {pending.length ? <div className="home-review-list">{pending.slice(0, 3).map((proposal) => <button key={proposal.id} onClick={() => onNavigate('review')}>
            <span><strong>{proposal.kind === 'claim' ? `${proposal.key}: ${proposal.value}` : proposal.title}</strong><small>Suggested {proposal.kind} · {proposal.source}</small></span><ArrowUpRight size={15}/>
          </button>)}</div> : <p className="home-thread-empty">Nothing needs your review.</p>}
        </section>

        {connections.length > 0 && <section className="home-thread home-relationships">
          <div className="home-thread-heading"><h2>Between things</h2></div>
          {connections.map((claim) => {
            const from = workspace.entities.find((entity) => entity.id === claim.subject)
            const to = workspace.entities.find((entity) => entity.id === claim.value)
            return from && to && <button key={claim.id} onClick={() => onSelectEntity(from)}><span>{from.title}</span><small>{claim.key}</small><span>{to.title}</span></button>
          })}
        </section>}

        <div className="home-home-actions">{workspace.entities.length > 0 && <button onClick={onNewEntity}><Plus size={15}/> Add knowledge</button>}<button onClick={onImport}><FileText size={15}/> Import a file</button></div>
      </div>
    </div>
  </section>
}
