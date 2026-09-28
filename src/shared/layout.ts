// A workbench layout composes editor groups in a tree of splits. Each group shows one view and keeps its own tabs.
// The tree can describe any arrangement; how many groups the UI allows is a separate policy.

/** Central workbench views that a session may name. */
export const workbenchViews = ['home', 'knowledge', 'review', 'documents', 'calendar', 'tasks', 'activity', 'settings', 'search'] as const
export type WorkbenchView = (typeof workbenchViews)[number]
export const isWorkbenchView = (value: string): value is WorkbenchView => (workbenchViews as readonly string[]).includes(value)

/** Views that open as tabs of their own. Home is a page, and Settings is a dialog rather than a place. */
export const tabViews = ['knowledge', 'review', 'documents', 'calendar', 'tasks', 'activity', 'search'] as const satisfies readonly WorkbenchView[]
export type TabView = (typeof tabViews)[number]
export const isTabView = (value: string): value is TabView => (tabViews as readonly string[]).includes(value)
export const viewTabUri = (view: TabView): string => `serenity:view/${view}`
export function parseViewTabUri(uri: string): TabView | null {
  const match = /^serenity:view\/([a-z]+)$/.exec(uri)
  return match && isTabView(match[1]) ? match[1] : null
}

export type SplitDirection = 'row' | 'column'
/** `sizes` are the children's shares of the split, summing to 1; without them children share equally. */
export type LayoutNode = { group: string } | { split: SplitDirection; children: LayoutNode[]; sizes?: number[] }

/** `presentations` maps an open resource URI to how this group shows it, when not the resource's default view. */
export interface SessionGroup { id: string; view: string; openUris: string[]; activeUri?: string; presentations?: Record<string, string>; viewPresentations?: Record<string, string> }
export interface SessionLayout { root: LayoutNode; groups: SessionGroup[]; focused: string }

/** Policy cap on panes, well beyond what fits on a screen; the saved format itself has no limit. */
export const maxEditorGroups = 16
export const maxTabsPerGroup = 30
const maxDepth = 8
const groupId = /^[a-z0-9-]{1,32}$/
export const presentationId = /^[a-z][a-z0-9-]{0,31}$/
/** No group in a split is resized below this share, so each stays usable and reachable. */
export const minSplitShare = 0.15

/** Valid shares for `count` children, scaled to sum to 1 and kept above the minimum share; undefined if unusable. */
export function normalizeSizes(sizes: unknown, count: number): number[] | undefined {
  if (!Array.isArray(sizes) || sizes.length !== count || count < 2 || sizes.some((size) => typeof size !== 'number' || !Number.isFinite(size) || size <= 0)) return undefined
  const floor = Math.min(minSplitShare, 1 / count)
  let shares = (sizes as number[]).map((size) => size / (sizes as number[]).reduce((sum, item) => sum + item, 0))
  const raised = shares.map((share) => Math.max(share, floor))
  const excess = raised.reduce((sum, share) => sum + share, 0) - 1
  const flexible = raised.reduce((sum, share) => sum + (share > floor ? share - floor : 0), 0)
  shares = raised.map((share) => share > floor && flexible > 0 ? share - excess * ((share - floor) / flexible) : share)
  return shares
}

/** Sets the shares of the split found by following `path` (child indexes) from the root. */
export function resizeSplit(root: LayoutNode, path: readonly number[], sizes: number[]): LayoutNode {
  if ('group' in root) return root
  if (!path.length) {
    const normalized = normalizeSizes(sizes, root.children.length)
    return normalized ? { ...root, sizes: normalized } : root
  }
  const [index, ...rest] = path
  return { ...root, children: root.children.map((child, position) => position === index ? resizeSplit(child, rest, sizes) : child) }
}

export function layoutGroupIds(node: LayoutNode): string[] {
  return 'group' in node ? [node.group] : node.children.flatMap(layoutGroupIds)
}

/**
 * Places `added` after `target` (or before it), joining an existing split in the same direction rather than nesting.
 * The new group takes half of the space `target` had.
 */
export function splitLayout(root: LayoutNode, target: string, added: string, direction: SplitDirection, before = false): LayoutNode {
  const leaf = { group: added }
  if ('group' in root) return root.group === target ? { split: direction, children: before ? [leaf, root] : [root, leaf] } : root
  const index = root.children.findIndex((child) => 'group' in child && child.group === target)
  if (index >= 0 && root.split === direction) {
    const at = before ? index : index + 1
    const sizes = root.sizes && [...root.sizes.slice(0, index), root.sizes[index] / 2, root.sizes[index] / 2, ...root.sizes.slice(index + 1)]
    return { ...root, children: [...root.children.slice(0, at), leaf, ...root.children.slice(at)], ...(sizes ? { sizes } : {}) }
  }
  return { ...root, children: root.children.map((child) => splitLayout(child, target, added, direction, before)) }
}

/** Removes a group and collapses any split left with a single child. Returns null if nothing remains. */
export function removeFromLayout(root: LayoutNode, id: string): LayoutNode | null {
  if ('group' in root) return root.group === id ? null : root
  const kept = root.children.map((child, index) => ({ child: removeFromLayout(child, id), size: root.sizes?.[index] })).filter((item) => item.child !== null)
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0].child
  const sizes = root.sizes && normalizeSizes(kept.map((item) => item.size), kept.length)
  return { split: root.split, children: kept.map((item) => item.child!), ...(sizes ? { sizes } : {}) }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseNode(value: unknown, depth: number): LayoutNode | null {
  if (!record(value) || depth > maxDepth) return null
  if (typeof value.group === 'string' && groupId.test(value.group) && Object.keys(value).length === 1) return { group: value.group }
  if ((value.split !== 'row' && value.split !== 'column') || !Array.isArray(value.children) || value.children.length < 2) return null
  const children = value.children.map((child) => parseNode(child, depth + 1))
  if (!children.every((child): child is LayoutNode => child !== null)) return null
  // Unusable sizes are dropped rather than rejecting the layout; the split falls back to equal shares.
  const sizes = normalizeSizes(value.sizes, children.length)
  return { split: value.split, children, ...(sizes ? { sizes } : {}) }
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
      (item.activeUri !== undefined && (typeof item.activeUri !== 'string' || !isUri(item.activeUri))) ||
      (item.presentations !== undefined && (!record(item.presentations) || Object.entries(item.presentations).some(([uri, id]) =>
        !(item.openUris as unknown[]).includes(uri) || typeof id !== 'string' || !presentationId.test(id)))) ||
      (item.viewPresentations !== undefined && (!record(item.viewPresentations) || Object.entries(item.viewPresentations).some(([view, id]) =>
        !isWorkbenchView(view) || typeof id !== 'string' || !presentationId.test(id))))) return null
    groups.push({ id: item.id, view: item.view, openUris: item.openUris as string[], ...(item.activeUri ? { activeUri: item.activeUri as string } : {}),
      ...(item.presentations && Object.keys(item.presentations).length ? { presentations: item.presentations as Record<string, string> } : {}),
      ...(item.viewPresentations && Object.keys(item.viewPresentations).length ? { viewPresentations: item.viewPresentations as Record<string, string> } : {}) })
  }
  const ids = layoutGroupIds(root)
  const known = new Set(groups.map((group) => group.id))
  if (known.size !== groups.length || ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id)) || !known.has(value.focused)) return null
  return { root, groups, focused: value.focused }
}

/** A rectangle as fractions of the whole layout area. */
export interface LayoutRect { x: number; y: number; width: number; height: number }

/** The boundary between two children of a split, which resizes that split when dragged. */
export interface LayoutDivider {
  /** Child indexes from the root to the split this divider belongs to. */
  path: number[]
  /** The divider sits between child `index - 1` and child `index`. */
  index: number
  direction: SplitDirection
  /** Where the boundary lies, as a zero-width (row) or zero-height (column) rectangle. */
  line: LayoutRect
  /** The split's own area, which drag positions are measured against. */
  area: LayoutRect
  sizes: number[]
}

/**
 * Where each group and divider sits, as fractions of the layout area. Rendering from these rectangles lets every pane
 * stay mounted in one place while the tree above it changes, so splitting or resizing never discards an open editor.
 */
export function layoutGeometry(root: LayoutNode, area: LayoutRect = { x: 0, y: 0, width: 1, height: 1 }, path: number[] = []):
  { groups: Map<string, LayoutRect>; dividers: LayoutDivider[] } {
  if ('group' in root) return { groups: new Map([[root.group, area]]), dividers: [] }
  const sizes = root.sizes ?? root.children.map(() => 1 / root.children.length)
  const groups = new Map<string, LayoutRect>()
  const dividers: LayoutDivider[] = []
  let offset = 0
  root.children.forEach((child, index) => {
    const along = root.split === 'row' ? area.width : area.height
    const start = (root.split === 'row' ? area.x : area.y) + offset * along
    const rect = root.split === 'row' ? { x: start, y: area.y, width: sizes[index] * along, height: area.height }
      : { x: area.x, y: start, width: area.width, height: sizes[index] * along }
    if (index > 0) dividers.push({ path, index, direction: root.split, area, sizes,
      line: root.split === 'row' ? { x: start, y: area.y, width: 0, height: area.height } : { x: area.x, y: start, width: area.width, height: 0 } })
    const nested = layoutGeometry(child, rect, [...path, index])
    for (const [id, groupRect] of nested.groups) groups.set(id, groupRect)
    dividers.push(...nested.dividers)
    offset += sizes[index]
  })
  return { groups, dividers }
}

/**
 * New shares for a split after dragging the divider before child `index` to `position` (a fraction of the split's own
 * length). Only the two neighbors change, and neither goes below the minimum share.
 */
export function dragDivider(sizes: readonly number[], index: number, position: number): number[] {
  const before = sizes.slice(0, index - 1).reduce((sum, size) => sum + size, 0)
  const pair = sizes[index - 1] + sizes[index]
  const floor = Math.min(minSplitShare, pair / 2)
  const first = Math.min(Math.max(position - before, floor), pair - floor)
  return sizes.map((size, position) => position === index - 1 ? first : position === index ? pair - first : size)
}

export type PaneDirection = 'left' | 'right' | 'up' | 'down'

/** The pane adjacent to `from` in a direction: beyond it on that axis and overlapping it across, nearest first. */
export function neighborGroup(groups: ReadonlyMap<string, LayoutRect>, from: string, direction: PaneDirection): string | null {
  const origin = groups.get(from)
  if (!origin) return null
  const epsilon = 1e-6
  const horizontal = direction === 'left' || direction === 'right'
  const overlap = (rect: LayoutRect): number => horizontal
    ? Math.min(origin.y + origin.height, rect.y + rect.height) - Math.max(origin.y, rect.y)
    : Math.min(origin.x + origin.width, rect.x + rect.width) - Math.max(origin.x, rect.x)
  const gap = (rect: LayoutRect): number => direction === 'left' ? origin.x - (rect.x + rect.width) : direction === 'right' ? rect.x - (origin.x + origin.width)
    : direction === 'up' ? origin.y - (rect.y + rect.height) : rect.y - (origin.y + origin.height)
  let best: { id: string; gap: number; overlap: number } | null = null
  for (const [id, rect] of groups) {
    if (id === from || gap(rect) < -epsilon || overlap(rect) <= epsilon) continue
    const candidate = { id, gap: gap(rect), overlap: overlap(rect) }
    if (!best || candidate.gap < best.gap - epsilon || (Math.abs(candidate.gap - best.gap) <= epsilon && candidate.overlap > best.overlap)) best = candidate
  }
  return best?.id ?? null
}
