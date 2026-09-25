import type { FormEvent } from 'react'
import { ArrowRight, Link2, Plus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Entity, WorkspaceSnapshot } from '../../shared/types'
import { identityCandidates } from '../../shared/identity'
import { ClaimCard } from './claim-card'

export interface KnowledgeViewProps {
  workspace: WorkspaceSnapshot
  selected: string | null
  draft: Entity | null
  dirty: boolean
  bodyMode: 'edit' | 'preview'
  claim: { key: string; value: string; source: string }
  claimTarget: string
  mergeTarget: string
  onSelectEntity(entity: Entity): boolean
  onNewEntity(): void
  onDraftChange(entity: Entity): void
  onBodyModeChange(mode: 'edit' | 'preview'): void
  onSave(event: FormEvent): void
  onClaimChange(claim: { key: string; value: string; source: string }): void
  onClaimTargetChange(id: string): void
  onAddClaim(event: FormEvent): void
  onMarkCurrent(id: string): void
  onRetract(id: string): void
  onClearCurrent(key: string): void
  onDiscuss(question: string): void
  onOpenSource(name: string): void
  onMergeTargetChange(id: string): void
  onMerge(): void
  onUndoMerge(id: string): void
}

export function KnowledgeView(props: KnowledgeViewProps) {
  const { workspace, selected, draft, dirty, bodyMode, claim, claimTarget, mergeTarget } = props
  const claims = workspace.claims.filter((item) => item.subject === selected)
  const incoming = workspace.claims.filter((item) => item.value === selected && item.subject !== selected && item.status === 'confirmed')
  const activeClaims = claims.filter((item) => item.status !== 'retracted')
  const conflicts = [...new Set(activeClaims.map((item) => item.key))].filter((key) => new Set(activeClaims.filter((item) => item.key === key).map((item) => item.value)).size > 1 && !activeClaims.some((item) => item.key === key && item.isCurrent))
  const resolvedKeys = [...new Set(activeClaims.filter((item) => item.isCurrent).map((item) => item.key))]
  const candidates = draft && !draft.id ? identityCandidates(draft.title, draft.type, workspace.entities).slice(0, 4) : []

  if (!draft) return <section className="page knowledge-index"><div className="knowledge-index-header"><div><span className="eyebrow">YOUR WORLD</span><h1>Knowledge</h1><p>People, places, projects, ideas—whatever matters to you. Everything can connect.</p></div><button className="primary" onClick={props.onNewEntity}><Plus size={16}/> New entity</button></div>
    {workspace.entities.length ? <div className="knowledge-tiles">{[...workspace.entities].sort((a, b) => a.title.localeCompare(b.title)).map((entity) => <button key={entity.id} onClick={() => props.onSelectEntity(entity)}><span className="knowledge-tile-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span><ArrowRight size={16}/></button>)}</div> :
      <div className="knowledge-blank"><Link2 size={25}/><h2>Start with what you know.</h2><p>Create a person, project, idea, or anything else meaningful to you. Categories are yours to define.</p><button className="primary" onClick={props.onNewEntity}>Create your first entity <ArrowRight size={16}/></button></div>}</section>

  return <div className="content">
    <aside className="knowledge-list-panel"><div className="list-heading"><span className="eyebrow">LIBRARY <span className="count">{workspace.entities.length}</span></span><button className="icon-button" onClick={props.onNewEntity} aria-label="New entity" title="New entity"><Plus size={15}/></button></div>
      <nav className="entity-list" aria-label="Entities">{workspace.entities.map((entity) => <button key={entity.id} className={`entity-link ${selected === entity.id ? 'active' : ''}`} onClick={() => props.onSelectEntity(entity)}><span className="entity-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span></button>)}</nav>
    </aside>
    <section className="editor"><form onSubmit={props.onSave}>
      <label className={draft.id ? 'sr-only' : 'field-label'} htmlFor="title">Name</label>
      <input id="title" className="title-input" placeholder="What is it called?" value={draft.title} required onChange={(event) => props.onDraftChange({ ...draft, title: event.target.value })}/>
      <label className={draft.id ? 'sr-only' : 'field-label'} htmlFor="type">Type · your own words</label>
      <input id="type" className="entity-type-input" placeholder="Person, project, concept..." value={draft.type} required onChange={(event) => props.onDraftChange({ ...draft, type: event.target.value })}/>
      {candidates.length > 0 && <div className="candidate-box"><strong>Could this already exist?</strong><p>Review these matches before creating a new entity. Similar names do not prove they are the same.</p>{candidates.map(({ entity }) => <button type="button" key={entity.id} onClick={() => props.onSelectEntity(entity)}>{entity.title} · {entity.type} ↗</button>)}</div>}
      <label className="sr-only" htmlFor="body">Context · Markdown</label>
      <div className="body-tabs"><button type="button" className={bodyMode === 'preview' ? 'active' : ''} onClick={() => props.onBodyModeChange('preview')}>Read</button><button type="button" className={bodyMode === 'edit' ? 'active' : ''} onClick={() => props.onBodyModeChange('edit')}>Edit</button></div>
      {bodyMode === 'edit' ? <textarea id="body" placeholder="Tell the story in your own words..." value={draft.body} onChange={(event) => props.onDraftChange({ ...draft, body: event.target.value })}/> :
        <div className="markdown-preview">{draft.body.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ children, href }) => <span className="preview-link" title={href}>{children}</span>,
          img: ({ alt }) => <span className="preview-image">[Image: {alt || 'no description'}]</span>
        }}>{draft.body}</ReactMarkdown> : <p className="hint">Nothing written yet. Switch to Edit Markdown to add context.</p>}</div>}
      <div className="form-actions"><span>{dirty ? 'Unsaved changes' : draft.id ? 'Saved' : 'Ready to create'}</span>{(dirty || !draft.id) && <button className="primary" type="submit">{draft.id ? 'Save changes' : 'Create entity'}</button>}</div>
    </form></section>
    <section className="details"><details className="knowledge-details" open={conflicts.length > 0 ? true : undefined}><summary><span>Facts & sources</span><small>{claims.length} {claims.length === 1 ? 'claim' : 'claims'}{conflicts.length ? ` · ${conflicts.length} to clarify` : ''}</small></summary><div className="knowledge-details-body">
      {resolvedKeys.map((key) => { const choice = activeClaims.find((item) => item.key === key && item.isCurrent)!; const decision = [...workspace.resolutions].reverse().find((item) => item.subject === selected && item.key === key && item.currentClaimId === choice.id); return <div className="current-banner" key={key}><strong>Current {key}: {workspace.entities.find((entity) => entity.id === choice.value)?.title ?? choice.value}</strong><small>{decision?.reason ?? 'Selected by the user'} · earlier claims remain below.</small><button onClick={() => props.onClearCurrent(key)}>Undo designation</button></div> })}
      {conflicts.map((key) => { const possible = activeClaims.filter((item) => item.key === key); const humanClaims = possible.filter((item) => item.origin === 'human'); const likely = humanClaims.length === 1 ? humanClaims[0] : null; return <div className="conflict" key={key}><strong>Conflicting {key}</strong><small>{likely ? `A direct statement suggests ${workspace.entities.find((entity) => entity.id === likely.value)?.title ?? likely.value}. This is not resolved.` : 'No clear answer from the available sources. Please clarify.'}</small><button onClick={() => props.onDiscuss(`I have conflicting information about ${draft.title}'s ${key}. What do the sources say, and what should I clarify?`)}>Discuss this ↗</button></div> })}
      {claims.map((item) => <ClaimCard key={item.id} claim={item} target={workspace.entities.find((entity) => entity.id === item.value)} mergedFrom={workspace.merges.find((merge) => merge.id === item.mergedFrom)} conflicting={conflicts.includes(item.key)} previousAlternative={resolvedKeys.includes(item.key)} sourceIsDocument={workspace.documents.some((document) => document.name === item.source)} onOpenSource={props.onOpenSource} onSelectTarget={props.onSelectEntity} onMarkCurrent={props.onMarkCurrent} onRetract={props.onRetract} />)}
      {claims.length === 0 && <p className="hint">No claims recorded yet.</p>}
      {incoming.length > 0 && <div className="incoming"><h3>Connected from elsewhere</h3>{incoming.map((link) => { const source = workspace.entities.find((entity) => entity.id === link.subject); return source && <button key={link.id} onClick={() => props.onSelectEntity(source)}>{source.title} · {link.key} ↗</button> })}</div>}
      {selected && <form className="claim-form" onSubmit={props.onAddClaim}><h3>Add a claim</h3><label htmlFor="claim-key">About or relationship</label><input id="claim-key" placeholder="e.g. birthday, friend of" required value={claim.key} onChange={(event) => props.onClaimChange({ ...claim, key: event.target.value })}/><label htmlFor="claim-value">Value</label><input id="claim-value" placeholder="e.g. September 7" required={!claimTarget} value={claim.value} onChange={(event) => props.onClaimChange({ ...claim, value: event.target.value })} disabled={Boolean(claimTarget)}/><label htmlFor="claim-target">Or link another entity</label><select id="claim-target" value={claimTarget} onChange={(event) => props.onClaimTargetChange(event.target.value)}><option value="">No entity linked</option>{workspace.entities.filter((entity) => entity.id !== selected).map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><label htmlFor="claim-source">Source</label><input id="claim-source" required value={claim.source} onChange={(event) => props.onClaimChange({ ...claim, source: event.target.value })}/><button type="submit" className="secondary">Add claim +</button></form>}
      {selected && workspace.entities.length > 1 && <div className="merge-form"><h3>Same as another entity?</h3><p>Archive this entity and resolve its links to the selected entity. Its original file and history remain available.</p><select aria-label="Merge into" value={mergeTarget} onChange={(event) => props.onMergeTargetChange(event.target.value)}><option value="">Choose the surviving entity</option>{workspace.entities.filter((entity) => entity.id !== selected).map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><button className="secondary" disabled={!mergeTarget} onClick={props.onMerge}>Merge into selected entity</button></div>}
      {selected && workspace.merges.filter((item) => item.target === selected).map((item) => <div className="merge-form" key={item.id}><h3>Archived as {draft.title}</h3><p>{item.title} was merged here. Its original file and links can be restored without deleting the merge history.</p><button className="secondary" onClick={() => props.onUndoMerge(item.id)}>Restore {item.title}</button></div>)}
    </div></details></section>
  </div>
}
