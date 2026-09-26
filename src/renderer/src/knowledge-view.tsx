import { ArrowRight, Link2, Plus } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'

export interface KnowledgeViewProps {
  workspace: WorkspaceSnapshot
  onOpenEntity(id: string): void
  onNewEntity(): void
}

/** The library of entities; an individual entity opens in an EntityEditor. */
export function KnowledgeView(props: KnowledgeViewProps) {
  const { workspace } = props
  return <section className="page knowledge-index"><div className="knowledge-index-header"><div><span className="eyebrow">YOUR WORLD</span><h1>Knowledge</h1><p>People, places, projects, ideas—whatever matters to you. Everything can connect.</p></div><button className="primary" onClick={props.onNewEntity}><Plus size={16}/> New entity</button></div>
    {workspace.entities.length ? <div className="knowledge-tiles">{[...workspace.entities].sort((a, b) => a.title.localeCompare(b.title)).map((entity) => <button key={entity.id} onClick={() => props.onOpenEntity(entity.id)}><span className="knowledge-tile-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span><ArrowRight size={16}/></button>)}</div> :
      <div className="knowledge-blank"><Link2 size={25}/><h2>Start with what you know.</h2><p>Create a person, project, idea, or anything else meaningful to you. Categories are yours to define.</p><button className="primary" onClick={props.onNewEntity}>Create your first entity <ArrowRight size={16}/></button></div>}</section>
}
