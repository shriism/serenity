// A workbench layout composes editor groups in a tree of splits. Each group shows one view and keeps its own tabs.
// The tree can describe any arrangement; how many groups the UI allows is a separate policy.

/** Central workbench views that a session may name. */
export const workbenchViews = ['home', 'knowledge', 'review', 'documents', 'calendar', 'tasks', 'activity', 'settings'] as const
export type WorkbenchView = (typeof workbenchViews)[number]
export const isWorkbenchView = (value: string): value is WorkbenchView => (workbenchViews as readonly string[]).includes(value)

export type SplitDirection = 'row' | 'column'
export type LayoutNode = { group: string } | { split: SplitDirection; children: LayoutNode[] }

export interface SessionGroup { id: string; view: string; openUris: string[]; activeUri?: string }
export interface SessionLayout { root: LayoutNode; groups: SessionGroup[]; focused: string }

/** Current policy: the center can split into two groups. Raising it needs no change to the saved format. */
export const maxEditorGroups = 2
export const maxTabsPerGroup = 30
const maxDepth = 8
const groupId = /^[a-z0-9-]{1,32}$/

export function layoutGroupIds(node: LayoutNode): string[] {
  return 'group' in node ? [node.group] : node.children.flatMap(layoutGroupIds)
}

/** Places `added` beside `target`, joining an existing split in the same direction rather than nesting. */
export function splitLayout(root: LayoutNode, target: string, added: string, direction: SplitDirection): LayoutNode {
  if ('group' in root) return root.group === target ? { split: direction, children: [root, { group: added }] } : root
  const index = root.children.findIndex((child) => 'group' in child && child.group === target)
  if (index >= 0 && root.split === direction) return { ...root, children: [...root.children.slice(0, index + 1), { group: added }, ...root.children.slice(index + 1)] }
  return { ...root, children: root.children.map((child) => splitLayout(child, target, added, direction)) }
}

/** Removes a group and collapses any split left with a single child. Returns null if nothing remains. */
export function removeFromLayout(root: LayoutNode, id: string): LayoutNode | null {
  if ('group' in root) return root.group === id ? null : root
  const children = root.children.map((child) => removeFromLayout(child, id)).filter((child): child is LayoutNode => child !== null)
  return children.length === 0 ? null : children.length === 1 ? children[0] : { ...root, children }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseNode(value: unknown, depth: number): LayoutNode | null {
  if (!record(value) || depth > maxDepth) return null
  if (typeof value.group === 'string' && groupId.test(value.group) && Object.keys(value).length === 1) return { group: value.group }
  if ((value.split !== 'row' && value.split !== 'column') || !Array.isArray(value.children) || value.children.length < 2) return null
  const children = value.children.map((child) => parseNode(child, depth + 1))
  return children.every((child): child is LayoutNode => child !== null) ? { split: value.split, children } : null
}

/**
 * Structural validation of a saved layout. Resource availability is checked by the caller; views and URIs are
 * checked for shape only. Returns null for anything malformed so a damaged session falls back to one group.
 */
export function parseLayout(value: unknown, isView: (view: string) => boolean, isUri: (uri: string) => boolean): SessionLayout | null {
  if (!record(value) || !Array.isArray(value.groups) || typeof value.focused !== 'string') return null
  const root = parseNode(value.root, 0)
  if (!root || value.groups.length === 0 || value.groups.length > maxEditorGroups) return null
  const groups: SessionGroup[] = []
  for (const item of value.groups) {
    if (!record(item) || typeof item.id !== 'string' || !groupId.test(item.id) || typeof item.view !== 'string' || !isView(item.view) ||
      !Array.isArray(item.openUris) || item.openUris.length > maxTabsPerGroup || item.openUris.some((uri) => typeof uri !== 'string' || !isUri(uri)) ||
      (item.activeUri !== undefined && (typeof item.activeUri !== 'string' || !isUri(item.activeUri)))) return null
    groups.push({ id: item.id, view: item.view, openUris: item.openUris as string[], ...(item.activeUri ? { activeUri: item.activeUri as string } : {}) })
  }
  const ids = layoutGroupIds(root)
  const known = new Set(groups.map((group) => group.id))
  if (known.size !== groups.length || ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id)) || !known.has(value.focused)) return null
  return { root, groups, focused: value.focused }
}
