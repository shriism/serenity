import type { WorkspaceSnapshot } from '../../shared/types'
import { parseResourceUri, resourceUri, type ResourceRef } from '../../shared/resources'
import { isTabView, parseViewTabUri, viewTabUri, type TabView } from '../../shared/layout'
import type { View } from './views'

/** What a tab shows: a workspace resource or a view such as Calendar. Both are restored with the session. */
export type TabKind = 'entity' | 'document' | 'page' | 'view'
export interface TabRef { kind: TabKind; id: string }
export type ResourceTabKind = Extract<TabKind, 'entity' | 'document' | 'page'>

export const viewTab = (view: TabView): TabRef => ({ kind: 'view', id: view })

// How the workbench presents an addressable resource. Tabs are restorable; the other targets are transient.
export type ResourceTarget =
  | { action: 'tab'; tab: TabRef; view: View }
  | { action: 'focus'; kind: 'task' | 'event'; id: string; view: 'tasks' | 'calendar' }
  | { action: 'external'; name: string }
  | { action: 'conversation'; id: string }

export type ViewAvailability = (view: View) => boolean

export const tabKey = (tab: TabRef): string => `${tab.kind}:${tab.id}`
export const isResourceTab = (tab: TabRef): tab is TabRef & { kind: ResourceTabKind } => tab.kind === 'entity' || tab.kind === 'document' || tab.kind === 'page'
/** The URI a tab is saved as. */
export function tabUri(tab: TabRef): string | undefined {
  if (tab.kind === 'view') return isTabView(tab.id) ? viewTabUri(tab.id) : undefined
  return resourceUri(tab as ResourceRef)
}

/** The view a tab renders in. */
export function tabViewOf(tab: TabRef): View {
  switch (tab.kind) {
    case 'entity': return 'knowledge'
    case 'document': return 'documents'
    case 'page': return 'home'
    case 'view': return tab.id as View
  }
}

export function routeResource(workspace: WorkspaceSnapshot, uri: string, available: ViewAvailability): ResourceTarget | null {
  const view = parseViewTabUri(uri)
  if (view) return available(view) ? { action: 'tab', tab: viewTab(view), view } : null
  const ref = parseResourceUri(uri)
  return ref ? routeRef(workspace, ref, available) : null
}

function routeRef(workspace: WorkspaceSnapshot, ref: ResourceRef, available: ViewAvailability): ResourceTarget | null {
  const tab = (kind: ResourceTabKind): ResourceTarget | null => {
    const target: TabRef = { kind, id: ref.id }
    return available(tabViewOf(target)) ? { action: 'tab', tab: target, view: tabViewOf(target) } : null
  }
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
    case 'page': return workspace.pages.some((item) => item.id === ref.id) ? tab('page') : null
    case 'task': return available('tasks') && workspace.tasks.some((item) => item.id === ref.id) ? { action: 'focus', kind: 'task', id: ref.id, view: 'tasks' } : null
    case 'event': return available('calendar') && workspace.events.some((item) => item.id === ref.id) ? { action: 'focus', kind: 'event', id: ref.id, view: 'calendar' } : null
    case 'conversation': return workspace.conversations.some((item) => item.id === ref.id) ? { action: 'conversation', id: ref.id } : null
    case 'proposal': return available('review') && workspace.proposals.some((item) => item.id === ref.id) ? { action: 'tab', tab: viewTab('review'), view: 'review' } : null
  }
}

/** Tabs that still resolve to an available resource or view, without duplicates, in their saved order. */
export function restoreTabs(workspace: WorkspaceSnapshot, uris: readonly string[], available: ViewAvailability): TabRef[] {
  const seen = new Set<string>()
  return uris.flatMap((uri) => {
    const target = routeResource(workspace, uri, available)
    if (target?.action !== 'tab' || seen.has(tabKey(target.tab))) return []
    seen.add(tabKey(target.tab))
    return [target.tab]
  })
}

export const viewTitles: Record<View, string> = { home: 'Home', knowledge: 'Knowledge', review: 'Review', documents: 'Documents', calendar: 'Calendar',
  tasks: 'Tasks', activity: 'Activity', settings: 'Settings', search: 'Search' }

export function tabTitle(workspace: WorkspaceSnapshot, tab: TabRef): string {
  switch (tab.kind) {
    case 'entity': return workspace.entities.find((item) => item.id === tab.id)?.title || 'Untitled'
    case 'page': return workspace.pages.find((item) => item.id === tab.id)?.title || tab.id
    case 'view': return viewTitles[tab.id as View] ?? tab.id
    case 'document': return tab.id
  }
}

/** Workspace-relative file behind a tab, if it has one. */
export function tabPath(workspace: WorkspaceSnapshot, tab: TabRef): string | undefined {
  if (tab.kind === 'entity') return `entities/${tab.id}.md`
  if (tab.kind === 'page') return workspace.pages.find((item) => item.id === tab.id)?.path ?? `pages/${tab.id}.md`
  if (tab.kind === 'document') return `documents/${tab.id}`
  return undefined
}
