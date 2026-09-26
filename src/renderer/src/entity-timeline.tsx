import { ArrowUpRight, CalendarDays, GitMerge, Inbox, Link2, ListTodo, Pin, Undo2, X } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { entityHistory, type HistoryKind } from '../../shared/entity-history'

const icons: Record<HistoryKind, typeof Link2> = {
  claim: Link2, retraction: X, resolution: Pin, merge: GitMerge, unmerge: Undo2, proposal: Inbox, mention: ArrowUpRight, event: CalendarDays, task: ListTodo
}
const origins = { human: 'direct statement', 'ai-statement': 'AI extraction', 'ai-inference': 'AI inference' }

/** How knowledge about an entity accumulated and changed, with every correction kept in place. */
export function EntityTimeline({ workspace, entityId, onOpenResource, onOpenSource }: {
  workspace: WorkspaceSnapshot
  entityId: string
  onOpenResource(uri: string, side: boolean): void
  onOpenSource(name: string): void
}) {
  const entity = workspace.entities.find((item) => item.id === entityId)
  const entries = entityHistory(workspace, entityId)
  const upcoming = entries.filter((entry) => entry.upcoming)
  const past = entries.filter((entry) => !entry.upcoming)
  const day = (at: string): string => at.slice(0, 10)
  const render = (list: typeof entries) => <ol className="timeline">{list.map((entry, index) => {
    const Icon = icons[entry.kind]
    const showDay = index === 0 || day(list[index - 1].at) !== day(entry.at)
    return <li key={entry.id} className={`timeline-entry kind-${entry.kind}`}>
      {showDay && <time dateTime={entry.at} className="timeline-day">{day(entry.at)}</time>}
      <span className="timeline-icon" aria-hidden="true"><Icon size={14}/></span>
      <div className="timeline-body">
        {entry.uri ? <button className="timeline-title" onClick={(event) => onOpenResource(entry.uri!, event.metaKey || event.ctrlKey)}>{entry.title} <ArrowUpRight size={13}/></button>
          : <strong className="timeline-title">{entry.title}</strong>}
        {entry.detail && <p>{entry.detail}</p>}
        {(entry.source || entry.origin) && <small>
          {entry.source && (workspace.documents.some((document) => document.name === entry.source) ?
            <button className="text-button" onClick={() => onOpenSource(entry.source!)}>From {entry.source} ↗</button> : <>From {entry.source}</>)}
          {entry.source && entry.origin && ' · '}{entry.origin && origins[entry.origin]}
        </small>}
      </div>
    </li>
  })}</ol>
  return <section className="page entity-timeline" aria-label={`${entity?.title ?? 'Entity'} timeline`}>
    <h1>{entity?.title}</h1>
    <p>How what you know about {entity?.title ?? 'this'} was recorded and corrected. Retracted and replaced claims stay in the record.</p>
    {upcoming.length > 0 && <><h2>Coming up</h2>{render([...upcoming].reverse())}</>}
    {past.length > 0 ? <><h2>History</h2>{render(past)}</> : <p className="hint">Nothing recorded about {entity?.title ?? 'this entity'} yet.</p>}
  </section>
}
