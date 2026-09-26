import type { CalendarEvent, Claim, Entity, TaskItem, WorkspaceSnapshot } from './types'

/** Whether a free-text source names this document, alone or followed by a location such as `, p. 2`. */
export function citesDocument(source: string | undefined, name: string): boolean {
  const text = source?.trim() ?? ''
  return text === name || (text.startsWith(name) && /^[\s,:;(#-]/.test(text.slice(name.length)))
}

export interface DocumentKnowledge {
  /** Entities with claims drawn from the document, and those claims. */
  about: { entity: Entity; claims: Claim[] }[]
  /** Entities whose own record names the document as their source. */
  created: Entity[]
  tasks: TaskItem[]
  events: CalendarEvent[]
  pending: number
  dismissed: number
}

/** Everything in the workspace that records this document as its source: what the person learned from it. */
export function documentKnowledge(snapshot: WorkspaceSnapshot, name: string): DocumentKnowledge {
  const bySubject = new Map<string, Claim[]>()
  for (const claim of snapshot.claims) if (citesDocument(claim.source, name)) bySubject.set(claim.subject, [...(bySubject.get(claim.subject) ?? []), claim])
  const about = [...bySubject].flatMap(([id, claims]) => {
    const entity = snapshot.entities.find((item) => item.id === id)
    return entity ? [{ entity, claims: claims.sort((a, b) => a.key.localeCompare(b.key) || b.recordedAt.localeCompare(a.recordedAt)) }] : []
  }).sort((a, b) => a.entity.title.localeCompare(b.entity.title))
  const proposals = snapshot.proposals.filter((item) => citesDocument(item.source, name))
  return {
    about,
    created: snapshot.entities.filter((entity) => citesDocument(entity.source, name)),
    tasks: snapshot.modules.tasks ? snapshot.tasks.filter((task) => citesDocument(task.source, name)) : [],
    events: snapshot.modules.calendar ? snapshot.events.filter((event) => citesDocument(event.source, name)) : [],
    pending: proposals.filter((item) => item.status === 'pending').length,
    dismissed: proposals.filter((item) => item.status === 'rejected').length
  }
}
