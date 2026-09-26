import { useMemo, useState } from 'react'
import { ArrowRight, LayoutGrid, Link2, Plus, Search, Share2 } from 'lucide-react'
import { WorkspaceGraph } from './workspace-graph'
import { entityTypes, filterEntities } from '../../shared/library'

// Enough to browse; a larger library is better approached through the filter than by scrolling thousands of tiles.
const shownLimit = 300
import type { WorkspaceSnapshot } from '../../shared/types'

export interface KnowledgeViewProps {
  workspace: WorkspaceSnapshot
  onOpenEntity(id: string): void
  /** Opens an entity from the graph; `side` opens it in the next pane. */
  onOpenInPane(id: string, side: boolean): void
  onNewEntity(): void
}

/** The library of entities; an individual entity opens in an EntityEditor. */
export function KnowledgeView(props: KnowledgeViewProps) {
  const { workspace } = props
  const [query, setQuery] = useState('')
  const [type, setType] = useState<string | null>(null)
  const types = useMemo(() => entityTypes(workspace.entities), [workspace.entities])
  const shown = useMemo(() => filterEntities(workspace.entities, query, type), [workspace.entities, query, type])
  const shownIds = useMemo(() => new Set(shown.map((entity) => entity.id)), [shown])
  const [mode, setMode] = useState<'tiles' | 'graph'>('tiles')
  return <section className="page knowledge-index"><div className="knowledge-index-header"><div><span className="eyebrow">YOUR WORLD</span><h1>Knowledge</h1><p>People, places, projects, ideas—whatever matters to you. Everything can connect.</p></div><button className="primary" onClick={props.onNewEntity}><Plus size={16}/> New entity</button></div>
    {workspace.entities.length ? <>
      <div className="library-filter">
        <div className="library-mode" role="group" aria-label="Show as">
          <button className={mode === 'tiles' ? 'active' : ''} aria-pressed={mode === 'tiles'} onClick={() => setMode('tiles')}><LayoutGrid size={14}/> Tiles</button>
          <button className={mode === 'graph' ? 'active' : ''} aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}><Share2 size={14}/> Graph</button>
        </div>
        <label className="library-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name or type" aria-label="Filter entities"/></label>
        {types.length > 1 && <div className="library-types" role="group" aria-label="Entity type">
          <button className={type === null ? 'active' : ''} aria-pressed={type === null} onClick={() => setType(null)}>All <small>{workspace.entities.length}</small></button>
          {types.slice(0, 12).map((item) => <button key={item.type} className={type === item.type ? 'active' : ''} aria-pressed={type === item.type}
            onClick={() => setType(type === item.type ? null : item.type)}>{item.type} <small>{item.count}</small></button>)}
        </div>}
      </div>
      {mode === 'graph' ? <WorkspaceGraph workspace={workspace} ids={shownIds} onOpenEntity={props.onOpenInPane}/> : shown.length ? <div className="knowledge-tiles">{shown.slice(0, shownLimit).map((entity) => <button key={entity.id} onClick={() => props.onOpenEntity(entity.id)}><span className="knowledge-tile-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span><ArrowRight size={16}/></button>)}</div> :
        <p className="hint">Nothing matches. Clear the filter or create a new entity.</p>}
      {mode === 'tiles' && shown.length > shownLimit && <p className="hint">Showing the first {shownLimit} of {shown.length}. Narrow the filter to find the rest.</p>}
    </> :
      <div className="knowledge-blank"><Link2 size={25}/><h2>Start with what you know.</h2><p>Create a person, project, idea, or anything else meaningful to you. Categories are yours to define.</p><button className="primary" onClick={props.onNewEntity}>Create your first entity <ArrowRight size={16}/></button></div>}</section>
}
