import type { WorkbenchSession, WorkspaceSnapshot } from '../../shared/types'
import { isTabView, layoutGroupIds, maxEditorGroups, maxTabsPerGroup, removeFromLayout, splitLayout, type LayoutNode, type SplitDirection } from '../../shared/layout'
import { resourceUri } from '../../shared/resources'
import { isResourceTab, restoreTabs, routeResource, tabKey, tabUri, tabViewOf, viewTab, type TabRef, type ViewAvailability } from './resource-routing'
import { isView, type View } from './views'

/**
 * One pane of the workbench: its tabs and which of them is shown. Every place (an entity, a page, Calendar, Search)
 * is a tab; a pane without tabs shows the New tab screen.
 */
export interface EditorGroup {
  id: string
  /** The view of the shown tab; `home` while the pane is empty. */
  view: View
  tabs: TabRef[]
  /** Key of the tab currently shown, or null for an empty pane. */
  activeTab: string | null
  /** How a tab is presented when not its resource's default view, keyed by tab. */
  presentations: Record<string, string>
  /** How a module view is presented in this pane, e.g. Tasks as a board. */
  viewPresentations: Partial<Record<View, string>>
}

export interface Workbench { root: LayoutNode; groups: EditorGroup[]; focused: string }

export const emptyGroup = (id: string): EditorGroup => ({ id, view: 'home', tabs: [], activeTab: null, presentations: {}, viewPresentations: {} })
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
  return group.tabs.find((item) => tabKey(item) === group.activeTab)
}

export function updateGroup(workbench: Workbench, id: string, update: (group: EditorGroup) => EditorGroup): Workbench {
  return { ...workbench, groups: workbench.groups.map((group) => group.id === id ? update(group) : group) }
}

/** Shows a tab, opening it just after the current one if it is not open yet. */
export function showTab(group: EditorGroup, tab: TabRef): EditorGroup {
  const key = tabKey(tab)
  let tabs = group.tabs
  if (!tabs.some((item) => tabKey(item) === key)) {
    const at = group.tabs.findIndex((item) => tabKey(item) === group.activeTab)
    tabs = at < 0 ? [...tabs, tab] : [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)]
  }
  return { ...group, tabs, view: tabViewOf(tab), activeTab: key }
}

/** Shows a view as a tab. Home has no tab of its own (it is a page), so it empties the pane's selection instead. */
export function showView(group: EditorGroup, view: View): EditorGroup {
  return isTabView(view) ? showTab(group, viewTab(view)) : { ...group, view: 'home', activeTab: null }
}

/** Swaps one tab for another in place. */
export function replaceTab(group: EditorGroup, key: string, tab: TabRef): EditorGroup {
  const index = group.tabs.findIndex((item) => tabKey(item) === key)
  if (index < 0) return showTab(group, tab)
  const others = group.tabs.filter((item, position) => position === index || tabKey(item) !== tabKey(tab))
  const tabs = others.map((item) => tabKey(item) === key ? tab : item)
  return { ...group, tabs, activeTab: group.activeTab === key ? tabKey(tab) : group.activeTab, view: group.activeTab === key ? tabViewOf(tab) : group.view }
}

/** Closes a tab; closing the shown one shows its neighbor, as tab strips usually do. */
export function removeTab(group: EditorGroup, key: string): EditorGroup {
  const index = group.tabs.findIndex((item) => tabKey(item) === key)
  if (index < 0) return group
  const tabs = group.tabs.filter((item) => tabKey(item) !== key)
  const { [key]: _closed, ...presentations } = group.presentations
  if (group.activeTab !== key) return { ...group, tabs, presentations }
  const next = tabs[Math.min(index, tabs.length - 1)]
  return { ...group, tabs, presentations, activeTab: next ? tabKey(next) : null, view: next ? tabViewOf(next) : 'home' }
}

/** Shows a tab through another of its resource's views; `undefined` returns it to the default. */
export function presentTab(group: EditorGroup, key: string, presentation: string | undefined): EditorGroup {
  const { [key]: _previous, ...others } = group.presentations
  return { ...group, presentations: presentation ? { ...others, [key]: presentation } : others }
}

export function presentView(group: EditorGroup, view: View, presentation: string): EditorGroup {
  return { ...group, viewPresentations: { ...group.viewPresentations, [view]: presentation } }
}

export function nextGroupId(workbench: Workbench, from: string = workbench.focused, step = 1): string | null {
  const ids = layoutGroupIds(workbench.root)
  if (ids.length < 2) return null
  return ids[(ids.indexOf(from) + step + ids.length) % ids.length]
}

function placeBefore(tabs: TabRef[], key: string, before: string | undefined): TabRef[] {
  const tab = tabs.find((item) => tabKey(item) === key)
  if (!tab || !before || before === key || !tabs.some((item) => tabKey(item) === before)) return tabs
  const others = tabs.filter((item) => tabKey(item) !== key)
  const index = others.findIndex((item) => tabKey(item) === before)
  return [...others.slice(0, index), tab, ...others.slice(index)]
}

/**
 * Moves a tab to another group, keeping how it was presented, and focuses that group; with `before`, it lands ahead
 * of that tab. Within one group, `before` reorders the strip.
 */
export function moveTab(workbench: Workbench, from: string, key: string, to: string, before?: string): Workbench {
  const source = findGroup(workbench, from)
  const tab = source?.tabs.find((item) => tabKey(item) === key)
  if (!source || !tab || !findGroup(workbench, to)) return workbench
  if (from === to) {
    const tabs = placeBefore(source.tabs, key, before)
    return tabs === source.tabs ? workbench : updateGroup(workbench, from, (group) => ({ ...group, tabs }))
  }
  const presentation = source.presentations[key]
  const moved = updateGroup(updateGroup(workbench, from, (group) => removeTab(group, key)), to, (group) => {
    const shown = presentTab(showTab(group, tab), key, presentation ?? group.presentations[key])
    return { ...shown, tabs: placeBefore(shown.tabs, key, before) }
  })
  return closeEmptyGroups({ ...moved, focused: to })
}

/**
 * Adds a group beside `from` and focuses it. By default the new group starts with the same shown tab, as a second
 * perspective on it; pass `duplicate: false` for an empty group to open something else in. Returns null at the limit.
 */
export function splitWorkbench(workbench: Workbench, options: { from?: string; direction?: SplitDirection; before?: boolean; duplicate?: boolean } = {}): Workbench | null {
  const from = findGroup(workbench, options.from ?? workbench.focused)
  if (!from || workbench.groups.length >= maxEditorGroups) return null
  const taken = new Set(workbench.groups.map((group) => group.id))
  let index = 2
  while (taken.has(`group-${index}`)) index++
  const id = `group-${index}`
  const shown = activeTabOf(from)
  const group = options.duplicate === false || !shown ? emptyGroup(id) :
    { ...presentTab(showTab(emptyGroup(id), shown), tabKey(shown), from.presentations[tabKey(shown)]), viewPresentations: { ...from.viewPresentations } }
  return { root: splitLayout(workbench.root, from.id, id, options.direction ?? 'row', options.before), groups: [...workbench.groups, group], focused: id }
}

/** Closes a group and its tabs. The last remaining group cannot be closed. */
export function closeGroup(workbench: Workbench, id: string): Workbench {
  const root = removeFromLayout(workbench.root, id)
  if (!root || workbench.groups.length < 2) return workbench
  const focused = workbench.focused === id ? nextGroupId(workbench, id) ?? layoutGroupIds(root)[0] : workbench.focused
  return { root, groups: workbench.groups.filter((group) => group.id !== id), focused }
}

/** Remove split panes left with no tabs; the final pane remains as the New tab screen. */
export function closeEmptyGroups(workbench: Workbench): Workbench {
  let next = workbench
  for (const group of workbench.groups) if (next.groups.length > 1 && !findGroup(next, group.id)?.tabs.length) next = closeGroup(next, group.id)
  return next
}

/** Drops tabs whose resources no longer open or whose views are unavailable. Unchanged input is returned as-is. */
export function pruneWorkbench(workbench: Workbench, workspace: WorkspaceSnapshot, available: ViewAvailability): Workbench {
  let changed = false
  const groups = workbench.groups.map((group) => {
    const restorable = new Set(restoreTabs(workspace, group.tabs.flatMap((tab) => tabUri(tab) ?? []), available).map(tabKey))
    const kept = group.tabs.filter((tab) => restorable.has(tabKey(tab)))
    if (kept.length === group.tabs.length) return group
    changed = true
    let next = group
    for (const tab of group.tabs) if (!kept.includes(tab)) next = removeTab(next, tabKey(tab))
    return next
  })
  return changed ? closeEmptyGroups({ ...workbench, groups }) : workbench
}

/** Resource shown by a group, as a URI; views are not resources. */
export function shownUri(group: EditorGroup): string | undefined {
  const tab = activeTabOf(group)
  return tab && isResourceTab(tab) ? resourceUri(tab) : undefined
}

export function workbenchSession(workbench: Workbench, assistantUri?: string): WorkbenchSession {
  const groups = orderedGroups(workbench).map((group) => {
    const tabs = group.tabs.slice(-maxTabsPerGroup)
    const active = activeTabOf(group)
    const activeUri = active && tabs.includes(active) ? tabUri(active) : undefined
    const presentations = Object.fromEntries(tabs.flatMap((tab) => group.presentations[tabKey(tab)] ? [[tabUri(tab)!, group.presentations[tabKey(tab)]]] : []))
    return { id: group.id, view: group.view, openUris: tabs.flatMap((tab) => tabUri(tab) ?? []), ...(activeUri ? { activeUri } : {}),
      ...(Object.keys(presentations).length ? { presentations } : {}),
      ...(Object.keys(group.viewPresentations).length ? { viewPresentations: group.viewPresentations } : {}) }
  })
  const focused = groups.find((group) => group.id === workbench.focused) ?? groups[0]
  return { view: focused.view, openUris: focused.openUris, activeUri: focused.activeUri, ...(assistantUri ? { assistantUri } : {}),
    layout: { root: workbench.root, groups, focused: focused.id } }
}

function restoreGroup(id: string, view: string, openUris: readonly string[], activeUri: string | undefined, workspace: WorkspaceSnapshot, available: ViewAvailability,
  saved: Readonly<Record<string, string>> = {}, viewPresentations: Readonly<Record<string, string>> = {}): EditorGroup {
  const tabs = restoreTabs(workspace, openUris, available)
  const presentations = Object.fromEntries(tabs.flatMap((tab) => saved[tabUri(tab)!] ? [[tabKey(tab), saved[tabUri(tab)!]]] : []))
  let group: EditorGroup = { ...emptyGroup(id), tabs, presentations, viewPresentations }
  const active = activeUri ? routeResource(workspace, activeUri, available) : null
  if (active?.action === 'tab') return showTab(group, active.tab)
  // Sessions from before views were tabs name a view without a tab for it; an empty Home meant the Home page.
  if (isView(view) && isTabView(view) && available(view)) return showTab(group, viewTab(view))
  if (view === 'home' && !tabs.length && workspace.pages.some((page) => page.id === workspace.workbench.homePage))
    group = showTab(group, { kind: 'page', id: workspace.workbench.homePage })
  return group
}

export function restoreWorkbench(session: WorkbenchSession, workspace: WorkspaceSnapshot, available: ViewAvailability): Workbench {
  const layout = session.layout
  if (layout) {
    return closeEmptyGroups({ root: layout.root, focused: layout.focused,
      groups: layout.groups.map((group) => restoreGroup(group.id, group.view, group.openUris, group.activeUri, workspace, available, group.presentations, group.viewPresentations)) })
  }
  return { ...initialWorkbench, groups: [restoreGroup('main', session.view, session.openUris, session.activeUri, workspace, available)] }
}

/** A fresh workbench showing the workspace's Home page, when it has one. */
export function homeWorkbench(workspace: WorkspaceSnapshot): Workbench {
  const home = workspace.pages.some((page) => page.id === workspace.workbench.homePage)
  return home ? updateGroup(initialWorkbench, 'main', (group) => showTab(group, { kind: 'page', id: workspace.workbench.homePage })) : initialWorkbench
}
