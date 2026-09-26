import { ArrowLeft, ArrowRight, CalendarDays, ListTodo, Minus } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { entityConnections, type ConnectionLink } from '../../shared/entity-history'

const maxDrawn = 14
const shorten = (text: string, length: number): string => text.length > length ? `${text.slice(0, length - 1)}…` : text

function linkLabel(link: ConnectionLink, title: string, subject: string): string {
  if (link.via !== 'claim') return `${link.via === 'event' ? 'Event' : 'Task'}: ${link.key}`
  return link.direction === 'out' ? `${subject} · ${link.key} → ${title}` : `${title} · ${link.key} → ${subject}`
}

/** An entity's neighborhood: confirmed relationships in either direction and records it shares with others. */
export function EntityConnections({ workspace, entityId, onOpenEntity }: {
  workspace: WorkspaceSnapshot
  entityId: string
  /** `side` opens in the other editor group. */
  onOpenEntity(id: string, side: boolean): void
}) {
  const entity = workspace.entities.find((item) => item.id === entityId)
  const connections = entityConnections(workspace, entityId)
  const drawn = connections.slice(0, maxDrawn)
  const size = 420
  const center = size / 2
  const radius = drawn.length > 1 ? 155 : 120
  const position = (index: number) => {
    const angle = (index / Math.max(drawn.length, 1)) * Math.PI * 2 - Math.PI / 2
    // Labels sit on the side away from the center so edges never cross them.
    return { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius, labelY: Math.sin(angle) < -0.35 ? -28 : 36 }
  }
  return <section className="page entity-connections" aria-label={`${entity?.title ?? 'Entity'} connections`}>
    <h1>{entity?.title}</h1>
    <p>Entities linked to {entity?.title ?? 'this'} by confirmed claims or shared events and tasks. Open a neighbor to keep exploring; ⌘/Ctrl-click opens it to the side.</p>
    {connections.length === 0 ? <p className="hint">No connections yet. Add a claim that links another entity, or relate an event or task.</p> : <>
      <svg className="connections-graph" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${entity?.title} and ${connections.length} connected ${connections.length === 1 ? 'entity' : 'entities'}`}>
        {drawn.map((connection, index) => { const { x, y } = position(index); return <line key={connection.entityId} x1={center} y1={center} x2={x} y2={y}
          className={connection.links.some((link) => link.via === 'claim') ? 'claim-edge' : 'shared-edge'} strokeWidth={Math.min(1 + connection.links.length * 0.6, 4)}/> })}
        <circle cx={center} cy={center} r={40} className="center-node"/>
        <text x={center} y={center + 4} textAnchor="middle" className="center-label">{shorten(entity?.title ?? '', 11)}</text>
        {drawn.map((connection, index) => { const { x, y, labelY } = position(index); return <g key={connection.entityId} className="neighbor-node"
          onClick={(event) => onOpenEntity(connection.entityId, event.metaKey || event.ctrlKey)}>
          <circle cx={x} cy={y} r={20}/><text x={x} y={y + labelY} textAnchor="middle">{shorten(connection.title, 18)}</text>
        </g> })}
      </svg>
      {connections.length > maxDrawn && <p className="hint">Showing the {maxDrawn} most connected in the diagram; all {connections.length} are listed below.</p>}
      <ul className="connections-list">{connections.map((connection) => <li key={connection.entityId}>
        <button className="connection-name" onClick={(event) => onOpenEntity(connection.entityId, event.metaKey || event.ctrlKey)}>
          <strong>{connection.title}</strong><small>{connection.type}{connection.further ? ` · ${connection.further} more ${connection.further === 1 ? 'connection' : 'connections'}` : ''}</small>
        </button>
        <ul>{connection.links.map((link) => {
          const Icon = link.via === 'event' ? CalendarDays : link.via === 'task' ? ListTodo : link.direction === 'out' ? ArrowRight : link.direction === 'in' ? ArrowLeft : Minus
          return <li key={`${link.via}:${link.recordId}`}><Icon size={13} aria-hidden="true"/>{linkLabel(link, connection.title, entity?.title ?? '')}
            {link.current ? <em> · current</em> : null}{link.source ? <small> · from {link.source}</small> : null}</li>
        })}</ul>
      </li>)}</ul>
    </>}
  </section>
}
