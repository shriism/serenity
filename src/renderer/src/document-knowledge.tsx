import { ArrowUpRight, CalendarDays, Link2, ListTodo } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { documentKnowledge } from '../../shared/provenance'
import { resourceUri } from '../../shared/resources'

/** What the workspace records as learned from a document, so its influence can be reviewed and corrected. */
export function DocumentKnowledgeView({ name, workspace, onOpenResource }: {
  name: string
  workspace: WorkspaceSnapshot
  /** `side` opens the record in the next pane. */
  onOpenResource(uri: string, side: boolean): void
}) {
  const knowledge = documentKnowledge(workspace, name)
  const open = (uri: string) => (event: { metaKey: boolean; ctrlKey: boolean }) => onOpenResource(uri, event.metaKey || event.ctrlKey)
  const title = (id: string): string => workspace.entities.find((entity) => entity.id === id)?.title ?? id
  const empty = !knowledge.about.length && !knowledge.created.length && !knowledge.tasks.length && !knowledge.events.length
  return <section className="page document-knowledge" aria-label={`Knowledge from ${name}`}>
    <h1>{name}</h1>
    <p>Everything in this workspace that names this document as its source. Retracted claims stay listed so corrections remain visible.
      {knowledge.pending ? ` ${knowledge.pending} ${knowledge.pending === 1 ? 'suggestion is' : 'suggestions are'} still waiting for review.` : ''}</p>
    {empty && <p className="hint">Nothing recorded from this document yet. Analyze it or add claims with it as their source.</p>}
    {knowledge.about.length > 0 && <><h2>Facts about</h2><ul className="knowledge-from">{knowledge.about.map(({ entity, claims }) => <li key={entity.id}>
      <button className="knowledge-from-entity" onClick={open(resourceUri({ kind: 'entity', id: entity.id }))}><Link2 size={14}/><strong>{entity.title}</strong><small>{entity.type}</small><ArrowUpRight size={13}/></button>
      <ul>{claims.map((claim) => <li key={claim.id} className={claim.status === 'retracted' ? 'retracted' : ''}>
        <span>{claim.key}: {title(claim.value)}</span>
        <small>{claim.status === 'retracted' ? `retracted${claim.retractionReason ? ` · ${claim.retractionReason}` : ''}` : claim.isCurrent ? 'current answer' : claim.status}{claim.source !== name ? ` · ${claim.source}` : ''}</small>
      </li>)}</ul>
    </li>)}</ul></>}
    {knowledge.created.length > 0 && <><h2>Entities introduced</h2><ul className="knowledge-from flat">{knowledge.created.map((entity) =>
      <li key={entity.id}><button className="knowledge-from-entity" onClick={open(resourceUri({ kind: 'entity', id: entity.id }))}><Link2 size={14}/><strong>{entity.title}</strong><small>{entity.type}</small><ArrowUpRight size={13}/></button></li>)}</ul></>}
    {(knowledge.tasks.length > 0 || knowledge.events.length > 0) && <><h2>Plans</h2><ul className="knowledge-from flat">
      {knowledge.events.map((event) => <li key={event.id}><button className="knowledge-from-entity" onClick={open(resourceUri({ kind: 'event', id: event.id }))}><CalendarDays size={14}/><strong>{event.title}</strong><small>{event.start}</small><ArrowUpRight size={13}/></button></li>)}
      {knowledge.tasks.map((task) => <li key={task.id}><button className="knowledge-from-entity" onClick={open(resourceUri({ kind: 'task', id: task.id }))}><ListTodo size={14}/><strong>{task.title}</strong><small>{task.completed ? 'done' : task.due ? `due ${task.due}` : 'open'}</small><ArrowUpRight size={13}/></button></li>)}
    </ul></>}
  </section>
}
