import type { WorkspaceSnapshot } from './types'
import { parseResourceUri, resourceUri, type ResourceKind } from './resources'
import { citesDocument } from './provenance'
import { workspaceActivity } from './activity'

export interface QueryItem { uri: string; kind: ResourceKind; title: string; detail: string; sortValue: string }
export type QueryDisplay = 'list' | 'table' | 'count'
/** `total` counts every match; `items` holds at most `limit` of them. */
export interface QueryResult { source: string; display: QueryDisplay; total: number; items: QueryItem[] }
const displays: readonly QueryDisplay[] = ['list', 'table', 'count']

const sources = ['upcoming', 'entities', 'claims', 'documents', 'tasks', 'events', 'proposals', 'pages', 'activity'] as const
type Source = (typeof sources)[number]
const filters: Partial<Record<Source, string[]>> = {
  entities: ['type', 'source'], claims: ['status', 'subject', 'key', 'source'], tasks: ['completed', 'source'], events: ['source'],
  proposals: ['status', 'kind', 'source'], pages: ['id'], activity: ['kind']
}
const sorts: Record<Source, string[]> = {
  upcoming: ['due', 'start', 'title'], entities: ['title'], claims: ['title', 'recordedAt'], documents: ['title'],
  tasks: ['title', 'due'], events: ['title', 'start'], proposals: ['title', 'recordedAt'], pages: ['title'], activity: ['recordedAt', 'title']
}

function mapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function evaluateWorkspaceQuery(snapshot: WorkspaceSnapshot, definition: unknown, today = new Date().toLocaleDateString('en-CA')): QueryResult {
  if (!mapping(definition) || !sources.includes(definition.from as Source)) throw new Error('Query needs a supported from source')
  const source = definition.from as Source
  const where = definition.where ?? {}
  if (!mapping(where)) throw new Error('Query where must be a mapping')
  for (const [key, value] of Object.entries(where)) {
    if (!filters[source]?.includes(key) || !['string', 'boolean'].includes(typeof value)) throw new Error(`Unsupported ${source} filter: ${key}`)
  }
  const limit = definition.limit ?? 10
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Query limit must be between 1 and 100')
  const display = definition.display ?? 'list'
  if (!displays.includes(display as QueryDisplay)) throw new Error('Query display must be list, table, or count')
  if (definition.sort !== undefined && !sorts[source].includes(String(definition.sort))) throw new Error(`Unsupported ${source} sort`)
  const item = (kind: ResourceKind, id: string, title: string, detail: string, sortValue: string): QueryItem =>
    ({ uri: resourceUri({ kind, id }), kind, title, detail, sortValue })
  // A source names a document, possibly followed by a location such as ', p. 2'; other fields compare exactly.
  const matches = (value: Record<string, unknown>): boolean => Object.entries(where).every(([key, expected]) =>
    key === 'source' ? typeof expected === 'string' && citesDocument(typeof value.source === 'string' ? value.source : undefined, expected) : value[key] === expected)
  const enabledTasks = snapshot.modules.tasks ? snapshot.tasks : []
  const enabledEvents = snapshot.modules.calendar ? snapshot.events : []
  const records: QueryItem[] = source === 'upcoming' ? [
    ...enabledTasks.filter((task) => !task.completed && task.due && task.due >= today).map((task) => item('task', task.id, task.title, `Task · ${task.due}`, task.due!)),
    ...enabledEvents.filter((event) => event.start.slice(0, 10) >= today).map((event) => item('event', event.id, event.title, `Event · ${event.start.slice(0, 10)}`, event.start))
  ] : source === 'entities' ? snapshot.entities.filter((entity) => matches(entity as unknown as Record<string, unknown>)).map((entity) => item('entity', entity.id, entity.title, entity.type, entity.title))
    : source === 'claims' ? snapshot.claims.filter((claim) => matches(claim as unknown as Record<string, unknown>)).map((claim) => item('claim', claim.id, `${snapshot.entities.find((entity) => entity.id === claim.subject)?.title ?? 'Unknown'} · ${claim.key}`, (snapshot.entities.find((entity) => entity.id === claim.value) ?? snapshot.archivedEntities.find((entity) => entity.id === claim.value))?.title ?? claim.value, claim.recordedAt))
      : source === 'documents' ? snapshot.documents.map((document) => item('document', document.name, document.name, 'Document', document.name))
        : source === 'tasks' ? enabledTasks.filter((task) => matches(task as unknown as Record<string, unknown>)).map((task) => item('task', task.id, task.title, task.due ?? 'No due date', task.due ?? ''))
          : source === 'events' ? enabledEvents.filter((event) => matches(event as unknown as Record<string, unknown>)).map((event) => item('event', event.id, event.title, event.start, event.start))
            : source === 'proposals' ? snapshot.proposals.filter((proposal) => matches(proposal as unknown as Record<string, unknown>)).map((proposal) => item('proposal', proposal.id, proposal.kind === 'claim' ? `${proposal.key}: ${proposal.value}` : proposal.title, `Suggested ${proposal.kind} · ${proposal.source}`, proposal.recordedAt))
              : source === 'activity' ? workspaceActivity(snapshot).filter((entry) => entry.uri && matches(entry as unknown as Record<string, unknown>)).flatMap((entry) => {
                const ref = parseResourceUri(entry.uri!)
                return ref ? [{ uri: entry.uri!, kind: ref.kind, title: entry.title, detail: entry.detail, sortValue: entry.at }] : []
              })
              : snapshot.pages.filter((page) => matches(page as unknown as Record<string, unknown>)).map((page) => item('page', page.id, page.title, 'Workspace page', page.title))
  const descending = definition.sort === 'recordedAt' || (definition.sort === undefined && (source === 'claims' || source === 'proposals' || source === 'activity'))
  const sorted = records.sort((a, b) => {
    const left = definition.sort === 'title' ? a.title : a.sortValue
    const right = definition.sort === 'title' ? b.title : b.sortValue
    return descending ? right.localeCompare(left) : left.localeCompare(right)
  })
  return { source, display: display as QueryDisplay, total: sorted.length, items: sorted.slice(0, limit) }
}
