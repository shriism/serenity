import type { WorkspaceSnapshot } from './types'

export type ResourceKind = 'entity' | 'claim' | 'document' | 'task' | 'event' | 'conversation' | 'proposal' | 'page'
export interface ResourceRef { kind: ResourceKind; id: string }
export interface ResourceDescriptor extends ResourceRef { uri: string; title: string; path?: string }

const kinds = new Set<ResourceKind>(['entity', 'claim', 'document', 'task', 'event', 'conversation', 'proposal', 'page'])

export function resourceUri(ref: ResourceRef): string {
  if (!kinds.has(ref.kind) || !ref.id || ref.id === '.' || ref.id === '..' || /[\\/]/.test(ref.id)) throw new Error('Invalid workspace resource')
  return `serenity:${ref.kind}/${encodeURIComponent(ref.id)}`
}

export function parseResourceUri(uri: string): ResourceRef | null {
  const match = /^serenity:([a-z]+)\/([^/]+)$/.exec(uri)
  if (!match || !kinds.has(match[1] as ResourceKind)) return null
  try {
    const ref = { kind: match[1] as ResourceKind, id: decodeURIComponent(match[2]) }
    return resourceUri(ref) === uri ? ref : null
  } catch { return null }
}

export function workspaceResources(snapshot: WorkspaceSnapshot): ResourceDescriptor[] {
  const make = (kind: ResourceKind, id: string, title: string, path?: string): ResourceDescriptor =>
    ({ kind, id, uri: resourceUri({ kind, id }), title, path })
  return [
    ...snapshot.entities.map((item) => make('entity', item.id, item.title, `entities/${item.id}.md`)),
    ...snapshot.documents.map((item) => make('document', item.name, item.name, `documents/${item.name}`)),
    ...snapshot.claims.map((item) => make('claim', item.id, `${item.key}: ${item.value}`, `claims/${item.id}.yaml`)),
    ...snapshot.tasks.map((item) => make('task', item.id, item.title, `tasks/${item.id}.yaml`)),
    ...snapshot.events.map((item) => make('event', item.id, item.title, `calendar/${item.id}.yaml`)),
    ...snapshot.conversations.map((item) => make('conversation', item.id, item.title, item.retained ? `conversations/${item.id}.yaml` : undefined)),
    ...snapshot.proposals.map((item) => make('proposal', item.id, item.kind === 'claim' ? `${item.key}: ${item.value}` : item.title, `proposals/${item.id}.yaml`)),
    ...snapshot.pages.map((item) => make('page', item.id, item.title, item.path))
  ]
}
