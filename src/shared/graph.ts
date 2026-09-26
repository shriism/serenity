import type { WorkspaceSnapshot } from './types'
import { resolveWikilink } from './wikilinks'

export interface GraphNode { id: string; title: string; type: string; degree: number; x: number; y: number }
export interface GraphEdge { from: string; to: string; weight: number }

const wikilinkTargets = /(?<!!)\[\[([^[\]|#\n]+)(?:#[^[\]|\n]*)?(?:\|[^[\]\n]+)?\]\]/g

/**
 * The workspace's entities and how they connect: confirmed claims between entities and wikilinks from one entity's
 * narrative to another. Limited to `ids` when given, then to the `limit` most connected entities.
 */
export function workspaceGraph(snapshot: Pick<WorkspaceSnapshot, 'entities' | 'claims' | 'pages' | 'documents'>, ids?: ReadonlySet<string>, limit = 150):
  { nodes: GraphNode[]; edges: GraphEdge[]; hidden: number } {
  const candidates = snapshot.entities.filter((entity) => !ids || ids.has(entity.id))
  const known = new Set(candidates.map((entity) => entity.id))
  const weights = new Map<string, number>()
  const link = (a: string, b: string): void => {
    if (a === b || !known.has(a) || !known.has(b)) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }
  for (const claim of snapshot.claims) if (claim.status === 'confirmed') link(claim.subject, claim.value)
  for (const entity of candidates) {
    if (!entity.body.includes('[[')) continue
    for (const match of entity.body.matchAll(wikilinkTargets)) {
      const target = resolveWikilink(snapshot, match[1])
      if (target.kind === 'resolved' && target.uri.startsWith('serenity:entity/')) link(entity.id, decodeURIComponent(target.uri.slice('serenity:entity/'.length)))
    }
  }
  const degree = new Map<string, number>()
  for (const [key, weight] of weights) for (const id of key.split('|')) degree.set(id, (degree.get(id) ?? 0) + weight)
  const kept = [...candidates].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.title.localeCompare(b.title)).slice(0, limit)
  const keptIds = new Set(kept.map((entity) => entity.id))
  const edges = [...weights].map(([key, weight]) => { const [from, to] = key.split('|'); return { from, to, weight } }).filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to))
  const nodes = layout(kept.map((entity) => ({ id: entity.id, title: entity.title, type: entity.type, degree: degree.get(entity.id) ?? 0, x: 0, y: 0 })), edges)
  return { nodes, edges, hidden: candidates.length - kept.length }
}

/** A small force-directed layout, seeded so the same graph always draws the same way. Positions lie within [0, 1]. */
export function layout(nodes: GraphNode[], edges: readonly GraphEdge[], iterations = 220): GraphNode[] {
  if (!nodes.length) return nodes
  let seed = 7
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const index = new Map(nodes.map((node, position) => [node.id, position]))
  const x = nodes.map(() => random())
  const y = nodes.map(() => random())
  const ideal = 1 / Math.sqrt(nodes.length) * 0.9
  for (let step = 0; step < iterations; step++) {
    const heat = 0.1 * (1 - step / iterations)
    const dx = new Array<number>(nodes.length).fill(0)
    const dy = new Array<number>(nodes.length).fill(0)
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const ox = x[a] - x[b] || 1e-6
      const oy = y[a] - y[b] || 1e-6
      const distance = Math.max(Math.hypot(ox, oy), 1e-3)
      const push = (ideal * ideal) / distance
      dx[a] += (ox / distance) * push; dy[a] += (oy / distance) * push
      dx[b] -= (ox / distance) * push; dy[b] -= (oy / distance) * push
    }
    for (const edge of edges) {
      const a = index.get(edge.from)!
      const b = index.get(edge.to)!
      const ox = x[a] - x[b]
      const oy = y[a] - y[b]
      const distance = Math.max(Math.hypot(ox, oy), 1e-3)
      const pull = (distance * distance) / ideal * Math.min(edge.weight, 3)
      dx[a] -= (ox / distance) * pull; dy[a] -= (oy / distance) * pull
      dx[b] += (ox / distance) * pull; dy[b] += (oy / distance) * pull
    }
    for (let node = 0; node < nodes.length; node++) {
      // A gentle pull to the middle keeps unconnected entities from drifting to the edges.
      dx[node] += (0.5 - x[node]) * 0.05
      dy[node] += (0.5 - y[node]) * 0.05
      const length = Math.max(Math.hypot(dx[node], dy[node]), 1e-9)
      x[node] += (dx[node] / length) * Math.min(length, heat)
      y[node] += (dy[node] / length) * Math.min(length, heat)
    }
  }
  const [minX, maxX, minY, maxY] = [Math.min(...x), Math.max(...x), Math.min(...y), Math.max(...y)]
  const scale = (value: number, low: number, high: number): number => high - low < 1e-9 ? 0.5 : (value - low) / (high - low)
  return nodes.map((node, position) => ({ ...node, x: scale(x[position], minX, maxX), y: scale(y[position], minY, maxY) }))
}
