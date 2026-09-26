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
  /** Tab last shown in a resuming view, so returning to that view picks up where the person left off. */
  recent: Partial<Record<View, string>>
  /** How a tab is presented when not its resource's default view, keyed by tab. */
  presentations: Record<string, string>
}

export interface Workbench { root: LayoutNode; groups: EditorGroup[]; focused: string }

export const emptyGroup = (id: string, view: View = 'home'): EditorGroup => ({ id, view, tabs: [], activeTab: null, creatingEntity: false, recent: {}, presentations: {} })

// Returning to Knowledge reopens the entity last shown there; choosing it again from that entity shows the library.
const resumingViews: ReadonlySet<View> = new Set(['knowledge'])
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

/** Navigates a group to a view, resuming its last resource where that view does so. */
export function enterView(group: EditorGroup, view: View): EditorGroup {
  const recent = group.view !== view && resumingViews.has(view) ? group.tabs.find((tab) => tabKey(tab) === group.recent[view]) : undefined
  if (recent) return showTab(group, recent)
  const { [view]: _left, ...others } = group.recent
  return { ...showView(group, view), recent: group.view === view ? others : group.recent }
}

export function showTab(group: EditorGroup, tab: TabRef): EditorGroup {
  const tabs = group.tabs.some((item) => tabKey(item) === tabKey(tab)) ? group.tabs : [...group.tabs, tab]
  const view = tabView[tab.kind]
  return { ...group, tabs, view, activeTab: tabKey(tab), creatingEntity: false, recent: resumingViews.has(view) ? { ...group.recent, [view]: tabKey(tab) } : group.recent }
}

export function removeTab(group: EditorGroup, key: string): EditorGroup {
  const recent = Object.fromEntries(Object.entries(group.recent).filter(([, value]) => value !== key)) as EditorGroup['recent']
  const { [key]: _closed, ...presentations } = group.presentations
  return { ...group, tabs: group.tabs.filter((item) => tabKey(item) !== key), activeTab: group.activeTab === key ? null : group.activeTab, recent, presentations }
}

/** Shows a tab through another of its resource's views; `undefined` returns it to the default. */
export function presentTab(group: EditorGroup, key: string, presentation: string | undefined): EditorGroup {
  const { [key]: _previous, ...others } = group.presentations
  return { ...group, presentations: presentation ? { ...others, [key]: presentation } : others }
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
  const group = options.duplicate === false ? emptyGroup(id) : shown ? presentTab(showTab(emptyGroup(id), shown), tabKey(shown), from.presentations[tabKey(shown)]) : emptyGroup(id, from.view)
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
    const kept = new Set(tabs.map(tabKey))
    const presentations = Object.fromEntries(Object.entries(group.presentations).filter(([key]) => kept.has(key)))
    return { ...group, tabs, view, activeTab, presentations, creatingEntity: group.creatingEntity && view === group.view }
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
    const tabs = group.tabs.slice(-maxTabsPerGroup)
    const presentations = Object.fromEntries(tabs.flatMap((tab) => group.presentations[tabKey(tab)] ? [[tabUri(tab), group.presentations[tabKey(tab)]]] : []))
    return { id: group.id, view: group.view, openUris: tabs.map(tabUri), ...(activeUri ? { activeUri } : {}), ...(Object.keys(presentations).length ? { presentations } : {}) }
  })
  const focused = groups.find((group) => group.id === workbench.focused) ?? groups[0]
  return { view: focused.view, openUris: focused.openUris, activeUri: focused.activeUri, ...(assistantUri ? { assistantUri } : {}),
    ...(groups.length > 1 || groups.some((group) => group.presentations) ? { layout: { root: workbench.root, groups, focused: focused.id } } : {}) }
}

function restoreGroup(id: string, view: string, openUris: readonly string[], activeUri: string | undefined, workspace: WorkspaceSnapshot, available: ViewAvailability,
  saved: Readonly<Record<string, string>> = {}): EditorGroup {
  const target: View = isView(view) && available(view) ? view : 'home'
  const tabs = restoreTabs(workspace, openUris, available)
  const presentations = Object.fromEntries(tabs.flatMap((tab) => saved[tabUri(tab)] ? [[tabKey(tab), saved[tabUri(tab)]]] : []))
  const group = { ...emptyGroup(id, target), tabs, presentations }
  const active = activeUri ? routeResource(workspace, activeUri, available) : null
  return active?.action === 'tab' && active.view === target ? showTab(group, active.tab) : group
}

export function restoreWorkbench(session: WorkbenchSession, workspace: WorkspaceSnapshot, available: ViewAvailability): Workbench {
  const layout = session.layout
  if (layout) {
    return { root: layout.root, focused: layout.focused,
      groups: layout.groups.map((group) => restoreGroup(group.id, group.view, group.openUris, group.activeUri, workspace, available, group.presentations)) }
  }
  return { ...initialWorkbench, groups: [restoreGroup('main', session.view, session.openUris, session.activeUri, workspace, available)] }
}
