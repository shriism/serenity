import type { Claim, WorkspaceSnapshot } from './types'
import { resourceUri } from './resources'

export type HistoryKind = 'claim' | 'retraction' | 'resolution' | 'merge' | 'unmerge' | 'proposal' | 'mention' | 'event' | 'task'

export interface HistoryEntry {
  id: string
  at: string
  kind: HistoryKind
  title: string
  detail: string
  source?: string
  origin?: Claim['origin']
  /** A resource to open for this entry, when it has one other than the entity itself. */
  uri?: string
  /** Scheduled after `now`: an upcoming event or task rather than something that happened. */
  upcoming?: boolean
}

/**
 * How knowledge about one entity accumulated and changed, newest first. Corrections are separate entries next to
 * what they correct, so the record reads as history rather than only the current answer.
 */
/** Claim values may be long Markdown (attached context); timelines show a short plain-text form. */
export function plainSummary(value: string, limit = 90): string {
  const plain = value.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain
}

export function entityHistory(snapshot: WorkspaceSnapshot, entityId: string, now = new Date().toISOString()): HistoryEntry[] {
  const title = (id: string): string => snapshot.entities.find((entity) => entity.id === id)?.title ?? plainSummary(id)
  const entries: HistoryEntry[] = []
  for (const claim of snapshot.claims) {
    if (claim.subject === entityId) {
      const merged = claim.mergedFrom ? `Carried over from ${snapshot.mergeHistory.find((merge) => merge.id === claim.mergedFrom)?.title ?? 'a merged entity'}` : ''
      const context = claim.key === 'context'
      entries.push({ id: `claim:${claim.id}`, at: claim.recordedAt, kind: 'claim',
        title: `${claim.status === 'proposed' ? 'Proposed' : 'Recorded'} ${context ? 'attached context' : `${claim.key}: ${title(claim.value)}`}`,
        detail: [context ? plainSummary(claim.value, 240) : '', merged].filter(Boolean).join(' · '), source: claim.source, origin: claim.origin })
      if (claim.retractedAt) entries.push({ id: `retraction:${claim.id}`, at: claim.retractedAt, kind: 'retraction', title: `Retracted ${claim.key}: ${title(claim.value)}`,
        detail: claim.retractionReason ?? '', source: claim.source, origin: claim.origin })
    } else if (claim.value === entityId && claim.status === 'confirmed') {
      entries.push({ id: `mention:${claim.id}`, at: claim.recordedAt, kind: 'mention', title: `${title(claim.subject)} · ${claim.key}`, detail: 'Linked from another entity',
        source: claim.source, origin: claim.origin, uri: resourceUri({ kind: 'entity', id: claim.subject }) })
    }
  }
  for (const resolution of snapshot.resolutions.filter((item) => item.subject === entityId)) {
    const chosen = snapshot.claims.find((claim) => claim.id === resolution.currentClaimId)
    entries.push({ id: `resolution:${resolution.id}`, at: resolution.recordedAt, kind: 'resolution',
      title: chosen ? `Chose current ${resolution.key}: ${title(chosen.value)}` : `Cleared current ${resolution.key}`, detail: resolution.reason })
  }
  for (const merge of snapshot.mergeHistory.filter((item) => item.target === entityId)) {
    entries.push({ id: `merge:${merge.id}:${merge.recordedAt}`, at: merge.recordedAt, kind: 'merge', title: `Merged ${merge.title} into this entity`, detail: 'The duplicate was archived with its history' })
    if (merge.undoneAt) entries.push({ id: `unmerge:${merge.id}:${merge.recordedAt}`, at: merge.undoneAt, kind: 'unmerge', title: `Restored ${merge.title} as a separate entity`,
      detail: merge.undoReason ?? '', uri: resourceUri({ kind: 'entity', id: merge.id }) })
  }
  for (const proposal of snapshot.proposals) {
    const about = proposal.kind === 'claim' ? proposal.subject === entityId : proposal.resolvedInto === entityId || proposal.createdEntityId === entityId ||
      ((proposal.kind === 'task' || proposal.kind === 'event') && proposal.relatedEntityIds.includes(entityId))
    if (!about) continue
    const what = proposal.kind === 'claim' ? `${proposal.key}: ${title(proposal.value)}` : proposal.title
    entries.push({ id: `proposal:${proposal.id}`, at: proposal.recordedAt, kind: 'proposal', title: `${proposal.provider.charAt(0).toUpperCase()}${proposal.provider.slice(1)} suggested ${proposal.kind} ${plainSummary(what)}`,
      detail: proposal.status === 'pending' ? 'Waiting for your review' : proposal.status === 'accepted' ? 'Accepted' : 'Dismissed', source: proposal.source, origin: proposal.origin,
      uri: resourceUri({ kind: 'proposal', id: proposal.id }) })
  }
  if (snapshot.modules.calendar) for (const event of snapshot.events.filter((item) => item.relatedEntityIds.includes(entityId))) {
    entries.push({ id: `event:${event.id}`, at: event.start, kind: 'event', title: event.title, detail: event.notes, source: event.source, origin: event.origin,
      uri: resourceUri({ kind: 'event', id: event.id }), upcoming: event.start > now })
  }
  if (snapshot.modules.tasks) for (const task of snapshot.tasks.filter((item) => item.relatedEntityIds.includes(entityId))) {
    const at = task.due ?? task.recordedAt ?? ''
    if (!at) continue
    entries.push({ id: `task:${task.id}`, at, kind: 'task', title: task.title, detail: task.completed ? 'Completed' : task.due ? `Due ${task.due}` : 'Open',
      source: task.source, origin: task.origin, uri: resourceUri({ kind: 'task', id: task.id }), upcoming: !task.completed && at > now })
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}

export interface ConnectionLink { key: string; direction: 'out' | 'in' | 'shared'; via: 'claim' | 'event' | 'task'; recordId: string; source?: string; current?: boolean }
export interface Connection { entityId: string; title: string; type: string; links: ConnectionLink[]; /** Connections this neighbor has beyond this entity. */ further: number }

function directNeighbors(snapshot: WorkspaceSnapshot, entityId: string): Map<string, ConnectionLink[]> {
  const exists = new Set(snapshot.entities.map((entity) => entity.id))
  const neighbors = new Map<string, ConnectionLink[]>()
  const add = (id: string, link: ConnectionLink): void => {
    if (id === entityId || !exists.has(id)) return
    neighbors.set(id, [...(neighbors.get(id) ?? []), link])
  }
  for (const claim of snapshot.claims.filter((item) => item.status === 'confirmed')) {
    if (claim.subject === entityId) add(claim.value, { key: claim.key, direction: 'out', via: 'claim', recordId: claim.id, source: claim.source, current: claim.isCurrent })
    else if (claim.value === entityId) add(claim.subject, { key: claim.key, direction: 'in', via: 'claim', recordId: claim.id, source: claim.source, current: claim.isCurrent })
  }
  const shared = [...(snapshot.modules.calendar ? snapshot.events.map((item) => ({ item, via: 'event' as const })) : []),
    ...(snapshot.modules.tasks ? snapshot.tasks.map((item) => ({ item, via: 'task' as const })) : [])]
  for (const { item, via } of shared) {
    if (!item.relatedEntityIds.includes(entityId)) continue
    for (const other of new Set(item.relatedEntityIds)) add(other, { key: item.title, direction: 'shared', via, recordId: item.id, source: item.source })
  }
  return neighbors
}

/** Entities linked to this one by confirmed claims in either direction, or by a shared event or task. */
export function entityConnections(snapshot: WorkspaceSnapshot, entityId: string): Connection[] {
  return [...directNeighbors(snapshot, entityId)].map(([id, links]) => {
    const entity = snapshot.entities.find((item) => item.id === id)!
    return { entityId: id, title: entity.title, type: entity.type, links, further: [...directNeighbors(snapshot, id).keys()].filter((other) => other !== entityId).length }
  }).sort((a, b) => b.links.length - a.links.length || a.title.localeCompare(b.title))
}
