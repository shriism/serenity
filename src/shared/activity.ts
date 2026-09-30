import type { WorkspaceSnapshot } from './types'
import { resourceUri } from './resources'
import { entityRepresentative } from './identity'
import { providerName } from './providers'


export type ActivityKind = 'claim' | 'merge' | 'resolution' | 'identity' | 'event' | 'task' | 'proposal' | 'message'
export interface ActivityItem { id: string; at: string; kind: ActivityKind; title: string; detail: string; uri?: string }

export const activityKinds: { kind: ActivityKind; label: string }[] = [
  { kind: 'claim', label: 'Claims' }, { kind: 'resolution', label: 'Decisions' }, { kind: 'merge', label: 'Merges' },
  { kind: 'identity', label: 'Identities' },
  { kind: 'proposal', label: 'Proposals' }, { kind: 'message', label: 'Conversations' }, { kind: 'task', label: 'Tasks' }, { kind: 'event', label: 'Events' }
]

/** Everything that happened in the workspace, newest first, each pointing at the record it concerns. */
export function workspaceActivity(snapshot: WorkspaceSnapshot): ActivityItem[] {
  const titles = new Map(snapshot.entities.map((entity) => [entity.id, entity.title]))
  const recordedNames = new Map([...snapshot.archivedEntities, ...snapshot.entities].map((entity) => [entity.id, entity.title]))
  const entityUri = (id: string): string | undefined => titles.has(id) ? resourceUri({ kind: 'entity', id }) : undefined
  const items: ActivityItem[] = [
    ...snapshot.claims.map((item) => ({ id: `claim:${item.id}`, at: item.recordedAt, kind: 'claim' as const, title: `${item.key}: ${titles.get(item.value) ?? item.value}`,
      detail: `${titles.get(item.subject) ?? 'Unknown entity'} · ${item.status === 'retracted' ? 'retracted · ' : ''}${item.source}`, uri: entityUri(item.subject) })),
    ...snapshot.mergeHistory.flatMap((item) => [
      { id: `merge:${item.id}:${item.recordedAt}`, at: item.recordedAt, kind: 'merge' as const, title: `Merged ${item.title}`, detail: `Archived; linked to ${titles.get(item.target) ?? item.target}`, uri: entityUri(item.target) },
      ...(item.undoneAt ? [{ id: `unmerge:${item.id}:${item.recordedAt}`, at: item.undoneAt, kind: 'merge' as const, title: `Restored ${item.title}`, detail: item.undoReason ?? 'Merge reversed', uri: entityUri(item.id) }] : [])
    ]),
    ...snapshot.resolutions.map((item) => ({ id: `resolution:${item.id}`, at: item.recordedAt, kind: 'resolution' as const,
      title: `${item.currentClaimId ? 'Chose current' : 'Cleared current'} ${item.key} for ${titles.get(item.subject) ?? 'an entity'}`, detail: item.reason, uri: entityUri(item.subject) })),
    ...snapshot.identityDecisions.flatMap((item) => {
      const pair = `${recordedNames.get(item.left) ?? item.left} and ${recordedNames.get(item.right) ?? item.right}`
      const uri = entityUri(entityRepresentative(item.left, snapshot.merges))
      return [{ id: `identity:${item.id}`, at: item.recordedAt, kind: 'identity' as const, title: `Marked ${pair} distinct`,
        detail: item.reason ?? 'Human identity decision', uri },
      ...(item.undoneAt ? [{ id: `identity-undo:${item.id}`, at: item.undoneAt, kind: 'identity' as const,
        title: `Reopened identity review for ${pair}`, detail: 'Distinct decision undone', uri }] : [])]
    }),
    ...(snapshot.modules.calendar ? snapshot.events.map((item) => ({ id: `event:${item.id}`, at: item.start, kind: 'event' as const, title: item.title,
      detail: `${item.notes}${item.source ? ` · Source: ${item.source}` : ''}`, uri: resourceUri({ kind: 'event', id: item.id }) })) : []),
    ...(snapshot.modules.tasks ? snapshot.tasks.map((item) => ({ id: `task:${item.id}`, at: item.recordedAt ?? item.due ?? '', kind: 'task' as const, title: item.title,
      detail: `${item.completed ? 'Completed' : 'Open'}${item.source ? ` · Source: ${item.source}` : ''}`, uri: resourceUri({ kind: 'task', id: item.id }) })) : []),
    ...snapshot.proposals.map((item) => ({ id: `proposal:${item.id}`, at: item.recordedAt, kind: 'proposal' as const,
      title: `${providerName(item.provider)} suggested ${item.kind === 'claim' ? `${item.key}: ${titles.get(item.value) ?? item.value}` : item.title}`, detail: item.status, uri: resourceUri({ kind: 'proposal', id: item.id }) })),
    ...snapshot.conversations.flatMap((conversation) => conversation.messages.map((message) => ({ id: `message:${message.id}`, at: message.recordedAt, kind: 'message' as const,
      title: `${message.role === 'user' ? 'You' : message.provider ? providerName(message.provider) : 'Assistant'} · ${conversation.title}`, detail: message.text.slice(0, 180),
      uri: conversation.retained ? resourceUri({ kind: 'conversation', id: conversation.id }) : undefined })))
  ]
  return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}

/** A heading for the day an item happened: Today, Yesterday, or the date in the person's locale. */
export function activityDay(at: string, now = new Date()): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return 'Date unknown'
  const day = (value: Date): string => value.toLocaleDateString('en-CA')
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return day(date) === day(now) ? 'Today' : day(date) === day(yesterday) ? 'Yesterday' : date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
}
