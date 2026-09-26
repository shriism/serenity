import type { WorkspaceSnapshot } from '../../shared/types'
import { parseResourceUri, resourceUri, type ResourceRef } from '../../shared/resources'
import type { View } from './views'

export type TabKind = 'entity' | 'document' | 'page'
export interface TabRef { kind: TabKind; id: string }

// How the workbench presents an addressable resource. Tabs are restorable; the other targets are transient.
export type ResourceTarget =
  | { action: 'tab'; tab: TabRef; view: View }
  | { action: 'home' }
  | { action: 'focus'; kind: 'task' | 'event'; id: string; view: 'tasks' | 'calendar' }
  | { action: 'external'; name: string }
  | { action: 'conversation'; id: string }
  | { action: 'view'; view: View }

export type ViewAvailability = (view: View) => boolean

export const tabKey = (tab: TabRef): string => `${tab.kind}:${tab.id}`
export const tabUri = (tab: TabRef): string => resourceUri(tab)
export const tabView: Record<TabKind, View> = { entity: 'knowledge', document: 'documents', page: 'home' }

export function routeResource(workspace: WorkspaceSnapshot, uri: string, available: ViewAvailability): ResourceTarget | null {
  const ref = parseResourceUri(uri)
  return ref ? routeRef(workspace, ref, available) : null
}

function routeRef(workspace: WorkspaceSnapshot, ref: ResourceRef, available: ViewAvailability): ResourceTarget | null {
  const tab = (kind: TabKind): ResourceTarget | null => available(tabView[kind]) ? { action: 'tab', tab: { kind, id: ref.id }, view: tabView[kind] } : null
  switch (ref.kind) {
    case 'entity': return workspace.entities.some((item) => item.id === ref.id) ? tab('entity') : null
    case 'claim': {
      const subject = workspace.claims.find((item) => item.id === ref.id)?.subject
      return subject ? routeRef(workspace, { kind: 'entity', id: subject }, available) : null
    }
    case 'document': {
      const document = workspace.documents.find((item) => item.name === ref.id)
      return !document ? null : document.extractable ? tab('document') : { action: 'external', name: document.name }
    }
    case 'page':
      if (!workspace.pages.some((item) => item.id === ref.id)) return null
      return ref.id === workspace.workbench.homePage ? available('home') ? { action: 'home' } : null : tab('page')
    case 'task': return available('tasks') && workspace.tasks.some((item) => item.id === ref.id) ? { action: 'focus', kind: 'task', id: ref.id, view: 'tasks' } : null
    case 'event': return available('calendar') && workspace.events.some((item) => item.id === ref.id) ? { action: 'focus', kind: 'event', id: ref.id, view: 'calendar' } : null
    case 'conversation': return workspace.conversations.some((item) => item.id === ref.id) ? { action: 'conversation', id: ref.id } : null
    case 'proposal': return available('review') && workspace.proposals.some((item) => item.id === ref.id) ? { action: 'view', view: 'review' } : null
  }
}

/** Tabs that still resolve to an available resource, without duplicates, in their saved order. */
export function restoreTabs(workspace: WorkspaceSnapshot, uris: readonly string[], available: ViewAvailability): TabRef[] {
  const seen = new Set<string>()
  return uris.flatMap((uri) => {
    const target = routeResource(workspace, uri, available)
    if (target?.action !== 'tab' || seen.has(tabKey(target.tab))) return []
    seen.add(tabKey(target.tab))
    return [target.tab]
  })
}

export function tabTitle(workspace: WorkspaceSnapshot, tab: TabRef): string {
  if (tab.kind === 'entity') return workspace.entities.find((item) => item.id === tab.id)?.title || 'Untitled'
  if (tab.kind === 'page') return workspace.pages.find((item) => item.id === tab.id)?.title || tab.id
  return tab.id
}

export function tabPath(workspace: WorkspaceSnapshot, tab: TabRef): string {
  if (tab.kind === 'entity') return `entities/${tab.id}.md`
  if (tab.kind === 'page') return workspace.pages.find((item) => item.id === tab.id)?.path ?? `pages/${tab.id}.md`
  return `documents/${tab.id}`
}
