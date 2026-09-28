import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { workspaceGraph } from '../../shared/graph'

const margin = 48
const labelled = 25

/** The workspace's entities and their links, as a map to explore. Opening a node opens the entity. */
export function WorkspaceGraph({ workspace, ids, onOpenEntity }: {
  workspace: WorkspaceSnapshot
  /** Entities to include, e.g. the library's current filter. */
  ids: ReadonlySet<string>
  /** `side` opens in the next pane. */
  onOpenEntity(id: string, side: boolean): void
}) {
  const graph = useMemo(() => workspaceGraph(workspace, ids), [workspace.entities, workspace.claims, workspace.pages, workspace.documents, ids])
  const [hovered, setHovered] = useState<string | null>(null)
  // Laid out at the pane's own width, so labels keep a readable size instead of shrinking with the drawing.
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [graph.nodes.length > 0])
  const height = Math.round(Math.min(640, Math.max(300, width * 0.62)))
  const place = (value: number, size: number): number => margin + value * (size - margin * 2)
  const position = new Map(graph.nodes.map((node) => [node.id, { x: place(node.x, width), y: place(node.y, height) }]))
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of graph.edges) {
      map.set(edge.from, (map.get(edge.from) ?? new Set()).add(edge.to))
      map.set(edge.to, (map.get(edge.to) ?? new Set()).add(edge.from))
    }
    return map
  }, [graph.edges])
  const prominent = new Set([...graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, labelled).filter((node) => node.degree > 0).map((node) => node.id))
  const near = (id: string): boolean => !hovered || id === hovered || Boolean(neighbors.get(hovered)?.has(id))
  if (!graph.nodes.length) return <p className="hint">No entities to show.</p>
  return <div className="workspace-graph" ref={frame}>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Graph of ${graph.nodes.length} entities and ${graph.edges.length} links`}>
      {graph.edges.map((edge) => { const a = position.get(edge.from)!; const b = position.get(edge.to)!
        return <line key={`${edge.from}|${edge.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={Math.min(1 + edge.weight * 0.5, 3)}
          className={hovered && (edge.from === hovered || edge.to === hovered) ? 'active' : hovered ? 'dim' : ''}/> })}
      {graph.nodes.map((node) => { const { x, y } = position.get(node.id)!
        const radius = 5 + Math.min(Math.sqrt(node.degree) * 3, 14)
        return <g key={node.id} className={`graph-node ${near(node.id) ? '' : 'dim'} ${node.id === hovered ? 'active' : ''}`} tabIndex={0} role="button"
          aria-label={`${node.title}, ${node.type}, ${node.degree} ${node.degree === 1 ? 'link' : 'links'}`}
          onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(node.id)} onBlur={() => setHovered(null)}
          onClick={(event) => onOpenEntity(node.id, event.metaKey || event.ctrlKey)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenEntity(node.id, event.metaKey || event.ctrlKey) } }}>
          <circle cx={x} cy={y} r={radius}/>
          {(prominent.has(node.id) || (hovered && near(node.id))) && <text x={x} y={y + radius + 14} textAnchor="middle">{node.title.length > 24 ? `${node.title.slice(0, 23)}…` : node.title}</text>}
        </g> })}
    </svg>
    <p className="hint">{graph.edges.length ? 'Lines are confirmed relationships and wikilinks between entities. Hover to highlight a neighborhood; ⌘/Ctrl-click opens in the next pane.' : 'No links yet between these entities.'}
      {graph.hidden ? ` Showing the ${graph.nodes.length} most connected; ${graph.hidden} more match the filter.` : ''}</p>
  </div>
}
