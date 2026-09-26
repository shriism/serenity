import type { WorkbenchSession, WorkspaceSnapshot } from '../../shared/types'
import { layoutGroupIds, maxEditorGroups, maxTabsPerGroup, removeFromLayout, splitLayout, type LayoutNode, type SplitDirection } from '../../shared/layout'
import { resourceUri } from '../../shared/resources'
import { restoreTabs, routeResource, tabKey, tabUri, tabView, type TabRef, type ViewAvailability } from './resource-routing'
import { isView, type View } from './views'

/** One place in the workbench: a view, the resource tabs opened there, and which of them is shown. */
export interface EditorGroup {
  id: string
  view: View
  tabs: TabRef[]
  /** Key of the tab currently shown; only set while `view` is that tab's view. */
  activeTab: string | null
  /** Showing a not-yet-saved entity draft in the Knowledge view. */
  creatingEntity: boolean
}

export interface Workbench { root: LayoutNode; groups: EditorGroup[]; focused: string }

export const emptyGroup = (id: string, view: View = 'home'): EditorGroup => ({ id, view, tabs: [], activeTab: null, creatingEntity: false })
export const initialWorkbench: Workbench = { root: { group: 'main' }, groups: [emptyGroup('main')], focused: 'main' }

export function findGroup(workbench: Workbench, id: string = workbench.focused): EditorGroup | undefined {
  return workbench.groups.find((group) => group.id === id)
}

export function focusedGroup(workbench: Workbench): EditorGroup {
  return findGroup(workbench) ?? workbench.groups[0]
}

/** Groups in reading order, following the layout tree. */
export function orderedGroups(workbench: Workbench): EditorGroup[] {
  return layoutGroupIds(workbench.root).flatMap((id) => findGroup(workbench, id) ?? [])
}

export function activeTabOf(group: EditorGroup): TabRef | undefined {
  const tab = group.tabs.find((item) => tabKey(item) === group.activeTab)
  return tab && tabView[tab.kind] === group.view ? tab : undefined
}

export function updateGroup(workbench: Workbench, id: string, update: (group: EditorGroup) => EditorGroup): Workbench {
  return { ...workbench, groups: workbench.groups.map((group) => group.id === id ? update(group) : group) }
}

export function showView(group: EditorGroup, view: View): EditorGroup {
  return { ...group, view, activeTab: null, creatingEntity: false }
}

export function showTab(group: EditorGroup, tab: TabRef): EditorGroup {
  const tabs = group.tabs.some((item) => tabKey(item) === tabKey(tab)) ? group.tabs : [...group.tabs, tab]
  return { ...group, tabs, view: tabView[tab.kind], activeTab: tabKey(tab), creatingEntity: false }
}

export function removeTab(group: EditorGroup, key: string): EditorGroup {
  return { ...group, tabs: group.tabs.filter((item) => tabKey(item) !== key), activeTab: group.activeTab === key ? null : group.activeTab }
}

export function nextGroupId(workbench: Workbench, from: string = workbench.focused): string | null {
  const ids = layoutGroupIds(workbench.root)
  if (ids.length < 2) return null
  return ids[(ids.indexOf(from) + 1) % ids.length]
}

/**
 * Adds a group beside `from` and focuses it. By default the new group starts with the same view and shown resource, as
 * a second perspective on it; pass `duplicate: false` for an empty group to open something else in. Returns null at
 * the group limit.
 */
export function splitWorkbench(workbench: Workbench, options: { from?: string; direction?: SplitDirection; duplicate?: boolean } = {}): Workbench | null {
  const from = findGroup(workbench, options.from ?? workbench.focused)
  if (!from || workbench.groups.length >= maxEditorGroups) return null
  const taken = new Set(workbench.groups.map((group) => group.id))
  let index = 2
  while (taken.has(`group-${index}`)) index++
  const id = `group-${index}`
  const shown = activeTabOf(from)
  const group = options.duplicate === false ? emptyGroup(id) : shown ? showTab(emptyGroup(id), shown) : emptyGroup(id, from.view)
  return { root: splitLayout(workbench.root, from.id, id, options.direction ?? 'row'), groups: [...workbench.groups, group], focused: id }
}

/** Closes a group and its tabs. The last remaining group cannot be closed. */
export function closeGroup(workbench: Workbench, id: string): Workbench {
  const root = removeFromLayout(workbench.root, id)
  if (!root || workbench.groups.length < 2) return workbench
  const focused = workbench.focused === id ? nextGroupId(workbench, id) ?? layoutGroupIds(root)[0] : workbench.focused
  return { root, groups: workbench.groups.filter((group) => group.id !== id), focused }
}

/** Drops tabs whose resources no longer open and views that are no longer available. Unchanged input is returned as-is. */
export function pruneWorkbench(workbench: Workbench, workspace: WorkspaceSnapshot, available: ViewAvailability): Workbench {
  let changed = false
  const groups = workbench.groups.map((group) => {
    const tabs = restoreTabs(workspace, group.tabs.map(tabUri), available)
    const view = available(group.view) ? group.view : 'home'
    if (tabs.length === group.tabs.length && view === group.view) return group
    changed = true
    const activeTab = view === group.view && tabs.some((tab) => tabKey(tab) === group.activeTab) ? group.activeTab : null
    return { ...group, tabs, view, activeTab, creatingEntity: group.creatingEntity && view === group.view }
  })
  return changed ? { ...workbench, groups } : workbench
}

/** Resource shown by a group, as a URI. Home shows its configured page even without a page tab. */
export function shownUri(group: EditorGroup, homePage: string): string | undefined {
  const tab = activeTabOf(group)
  return tab ? tabUri(tab) : group.view === 'home' ? resourceUri({ kind: 'page', id: homePage }) : undefined
}

export function workbenchSession(workbench: Workbench, homePage: string, assistantUri?: string): WorkbenchSession {
  const groups = orderedGroups(workbench).map((group) => {
    const activeUri = shownUri(group, homePage)
    return { id: group.id, view: group.view, openUris: group.tabs.slice(-maxTabsPerGroup).map(tabUri), ...(activeUri ? { activeUri } : {}) }
  })
  const focused = groups.find((group) => group.id === workbench.focused) ?? groups[0]
  return { view: focused.view, openUris: focused.openUris, activeUri: focused.activeUri, ...(assistantUri ? { assistantUri } : {}),
    ...(groups.length > 1 ? { layout: { root: workbench.root, groups, focused: focused.id } } : {}) }
}

function restoreGroup(id: string, view: string, openUris: readonly string[], activeUri: string | undefined, workspace: WorkspaceSnapshot, available: ViewAvailability): EditorGroup {
  const target: View = isView(view) && available(view) ? view : 'home'
  const group = { ...emptyGroup(id, target), tabs: restoreTabs(workspace, openUris, available) }
  const active = activeUri ? routeResource(workspace, activeUri, available) : null
  return active?.action === 'tab' && active.view === target ? showTab(group, active.tab) : group
}

export function restoreWorkbench(session: WorkbenchSession, workspace: WorkspaceSnapshot, available: ViewAvailability): Workbench {
  const layout = session.layout
  if (layout && layout.groups.length > 1) {
    return { root: layout.root, focused: layout.focused,
      groups: layout.groups.map((group) => restoreGroup(group.id, group.view, group.openUris, group.activeUri, workspace, available)) }
  }
  return { ...initialWorkbench, groups: [restoreGroup('main', session.view, session.openUris, session.activeUri, workspace, available)] }
}
