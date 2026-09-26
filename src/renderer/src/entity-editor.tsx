import { useEffect, useId, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Entity, WorkspaceSnapshot } from '../../shared/types'
import { identityCandidates } from '../../shared/identity'
import { ClaimCard } from './claim-card'

export interface EntityEditorProps {
  workspace: WorkspaceSnapshot
  /** The entity to edit, or null to draft a new one. */
  entityId: string | null
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
  onDirtyChange(dirty: boolean): void
  onOpenEntity(id: string): void
  onNewEntity(): void
  /** A new entity was saved and should replace this draft. */
  onCreated(id: string): void
  onDiscuss(question: string): void
  onOpenSource(name: string): void
}

const blank: Entity = { id: '', title: '', type: '', body: '' }
const emptyClaim = { key: '', value: '', source: 'Me' }

/** Edits one entity's narrative and its sourced claims. Each open editor owns its own draft. */
export function EntityEditor(props: EntityEditorProps) {
  const { workspace, entityId: selected, onUpdate, onError, onDirtyChange } = props
  const saved = selected ? workspace.entities.find((entity) => entity.id === selected) : undefined
  const [draft, setDraft] = useState<Entity>(() => saved ? { ...saved } : { ...blank })
  const [dirty, setDirty] = useState(false)
  const [bodyMode, setBodyMode] = useState<'edit' | 'preview'>(selected ? 'preview' : 'edit')
  const [claim, setClaim] = useState(emptyClaim)
  const [claimTarget, setClaimTarget] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const id = useId()
  useEffect(() => { if (!dirty && saved) setDraft({ ...saved }) }, [saved, dirty])
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  async function run(action: () => Promise<WorkspaceSnapshot>): Promise<WorkspaceSnapshot | null> {
    try { const next = await action(); onUpdate(next); onError(''); return next }
    catch (cause) { onError(String(cause)); return null }
  }

  function change(entity: Entity): void { setDraft(entity); setDirty(true) }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    const next = await run(() => window.serenity.saveEntity(draft))
    if (!next) return
    setDirty(false)
    if (!draft.id) {
      const created = next.entities.find((entity) => !workspace.entities.some((existing) => existing.id === entity.id))
      if (created) props.onCreated(created.id)
    }
  }

  async function addClaim(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    if (await run(() => window.serenity.addClaim({ ...claim, value: claimTarget || claim.value, subject: selected }))) {
      setClaim(emptyClaim)
      setClaimTarget('')
    }
  }

  function retract(claimId: string): void {
    const reason = window.prompt('Why is this claim no longer current? The original assertion will remain in history.')
    if (reason?.trim()) void run(() => window.serenity.retractClaim(claimId, reason))
  }

  function markCurrent(claimId: string): void {
    const reason = window.prompt('Why should this be the current answer? Previous claims will remain visible.')
    if (reason?.trim()) void run(() => window.serenity.setCurrentClaim(claimId, reason))
  }

  function clearCurrent(key: string): void {
    if (selected && window.confirm('Clear the current designation? Conflicting claims will again need clarification.')) void run(() => window.serenity.clearCurrentClaim(selected, key))
  }

  async function merge(): Promise<void> {
    if (!selected || !mergeTarget) return
    if (dirty) { onError('Save or discard your edits before merging.'); return }
    const target = workspace.entities.find((entity) => entity.id === mergeTarget)
    if (!window.confirm(`Archive ${draft.title} and link its claims to ${target?.title}? The archived file and merge record remain in the workspace.`)) return
    if (await run(() => window.serenity.mergeEntities(selected, mergeTarget))) props.onOpenEntity(mergeTarget)
  }

  function undoMerge(source: string): void {
    const reason = window.prompt('Why are you restoring this archived entity? The merge history will remain visible.')
    if (reason?.trim()) void run(() => window.serenity.unmergeEntities(source, reason))
  }

  const claims = workspace.claims.filter((item) => item.subject === selected)
  const incoming = workspace.claims.filter((item) => item.value === selected && item.subject !== selected && item.status === 'confirmed')
  const activeClaims = claims.filter((item) => item.status !== 'retracted')
  const conflicts = [...new Set(activeClaims.map((item) => item.key))].filter((key) => new Set(activeClaims.filter((item) => item.key === key).map((item) => item.value)).size > 1 && !activeClaims.some((item) => item.key === key && item.isCurrent))
  const resolvedKeys = [...new Set(activeClaims.filter((item) => item.isCurrent).map((item) => item.key))]
  const candidates = !draft.id ? identityCandidates(draft.title, draft.type, workspace.entities).slice(0, 4) : []
  const others = workspace.entities.filter((entity) => entity.id !== selected)

  return <div className="content">
    <aside className="knowledge-list-panel"><div className="list-heading"><span className="eyebrow">LIBRARY <span className="count">{workspace.entities.length}</span></span><button className="icon-button" onClick={props.onNewEntity} aria-label="New entity" title="New entity"><Plus size={15}/></button></div>
      <nav className="entity-list" aria-label="Entities">{workspace.entities.map((entity) => <button key={entity.id} className={`entity-link ${selected === entity.id ? 'active' : ''}`} onClick={() => props.onOpenEntity(entity.id)}><span className="entity-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span></button>)}</nav>
    </aside>
    <section className="editor"><form onSubmit={(event) => void save(event)}>
      <label className={draft.id ? 'sr-only' : 'field-label'} htmlFor={`${id}-title`}>Name</label>
      <input id={`${id}-title`} className="title-input" placeholder="What is it called?" value={draft.title} required onChange={(event) => change({ ...draft, title: event.target.value })}/>
      <label className={draft.id ? 'sr-only' : 'field-label'} htmlFor={`${id}-type`}>Type · your own words</label>
      <input id={`${id}-type`} className="entity-type-input" placeholder="Person, project, concept..." value={draft.type} required onChange={(event) => change({ ...draft, type: event.target.value })}/>
      {candidates.length > 0 && <div className="candidate-box"><strong>Could this already exist?</strong><p>Review these matches before creating a new entity. Similar names do not prove they are the same.</p>{candidates.map(({ entity }) => <button type="button" key={entity.id} onClick={() => props.onOpenEntity(entity.id)}>{entity.title} · {entity.type} ↗</button>)}</div>}
      <label className="sr-only" htmlFor={`${id}-body`}>Context · Markdown</label>
      <div className="body-tabs"><button type="button" className={bodyMode === 'preview' ? 'active' : ''} onClick={() => setBodyMode('preview')}>Read</button><button type="button" className={bodyMode === 'edit' ? 'active' : ''} onClick={() => setBodyMode('edit')}>Edit</button></div>
      {bodyMode === 'edit' ? <textarea id={`${id}-body`} placeholder="Tell the story in your own words..." value={draft.body} onChange={(event) => change({ ...draft, body: event.target.value })}/> :
        <div className="markdown-preview">{draft.body.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ children, href }) => <span className="preview-link" title={href}>{children}</span>,
          img: ({ alt }) => <span className="preview-image">[Image: {alt || 'no description'}]</span>
        }}>{draft.body}</ReactMarkdown> : <p className="hint">Nothing written yet. Switch to Edit Markdown to add context.</p>}</div>}
      <div className="form-actions"><span>{dirty ? 'Unsaved changes' : draft.id ? 'Saved' : 'Ready to create'}</span>{(dirty || !draft.id) && <button className="primary" type="submit">{draft.id ? 'Save changes' : 'Create entity'}</button>}</div>
    </form></section>
    <section className="details"><details className="knowledge-details" open={conflicts.length > 0 ? true : undefined}><summary><span>Facts & sources</span><small>{claims.length} {claims.length === 1 ? 'claim' : 'claims'}{conflicts.length ? ` · ${conflicts.length} to clarify` : ''}</small></summary><div className="knowledge-details-body">
      {resolvedKeys.map((key) => { const choice = activeClaims.find((item) => item.key === key && item.isCurrent)!; const decision = [...workspace.resolutions].reverse().find((item) => item.subject === selected && item.key === key && item.currentClaimId === choice.id); return <div className="current-banner" key={key}><strong>Current {key}: {workspace.entities.find((entity) => entity.id === choice.value)?.title ?? choice.value}</strong><small>{decision?.reason ?? 'Selected by the user'} · earlier claims remain below.</small><button onClick={() => clearCurrent(key)}>Undo designation</button></div> })}
      {conflicts.map((key) => { const possible = activeClaims.filter((item) => item.key === key); const humanClaims = possible.filter((item) => item.origin === 'human'); const likely = humanClaims.length === 1 ? humanClaims[0] : null; return <div className="conflict" key={key}><strong>Conflicting {key}</strong><small>{likely ? `A direct statement suggests ${workspace.entities.find((entity) => entity.id === likely.value)?.title ?? likely.value}. This is not resolved.` : 'No clear answer from the available sources. Please clarify.'}</small><button onClick={() => props.onDiscuss(`I have conflicting information about ${draft.title}'s ${key}. What do the sources say, and what should I clarify?`)}>Discuss this ↗</button></div> })}
      {claims.map((item) => <ClaimCard key={item.id} claim={item} target={workspace.entities.find((entity) => entity.id === item.value)} mergedFrom={workspace.merges.find((merge) => merge.id === item.mergedFrom)} conflicting={conflicts.includes(item.key)} previousAlternative={resolvedKeys.includes(item.key)} sourceIsDocument={workspace.documents.some((document) => document.name === item.source)} onOpenSource={props.onOpenSource} onSelectTarget={(entity) => props.onOpenEntity(entity.id)} onMarkCurrent={markCurrent} onRetract={retract} />)}
      {claims.length === 0 && <p className="hint">No claims recorded yet.</p>}
      {incoming.length > 0 && <div className="incoming"><h3>Connected from elsewhere</h3>{incoming.map((link) => { const source = workspace.entities.find((entity) => entity.id === link.subject); return source && <button key={link.id} onClick={() => props.onOpenEntity(source.id)}>{source.title} · {link.key} ↗</button> })}</div>}
      {selected && <form className="claim-form" onSubmit={(event) => void addClaim(event)}><h3>Add a claim</h3><label htmlFor={`${id}-claim-key`}>About or relationship</label><input id={`${id}-claim-key`} placeholder="e.g. birthday, friend of" required value={claim.key} onChange={(event) => setClaim({ ...claim, key: event.target.value })}/><label htmlFor={`${id}-claim-value`}>Value</label><input id={`${id}-claim-value`} placeholder="e.g. September 7" required={!claimTarget} value={claim.value} onChange={(event) => setClaim({ ...claim, value: event.target.value })} disabled={Boolean(claimTarget)}/><label htmlFor={`${id}-claim-target`}>Or link another entity</label><select id={`${id}-claim-target`} value={claimTarget} onChange={(event) => setClaimTarget(event.target.value)}><option value="">No entity linked</option>{others.map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><label htmlFor={`${id}-claim-source`}>Source</label><input id={`${id}-claim-source`} required value={claim.source} onChange={(event) => setClaim({ ...claim, source: event.target.value })}/><button type="submit" className="secondary">Add claim +</button></form>}
      {selected && others.length > 0 && <div className="merge-form"><h3>Same as another entity?</h3><p>Archive this entity and resolve its links to the selected entity. Its original file and history remain available.</p><select aria-label="Merge into" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Choose the surviving entity</option>{others.map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><button className="secondary" disabled={!mergeTarget} onClick={() => void merge()}>Merge into selected entity</button></div>}
      {selected && workspace.merges.filter((item) => item.target === selected).map((item) => <div className="merge-form" key={item.id}><h3>Archived as {draft.title}</h3><p>{item.title} was merged here. Its original file and links can be restored without deleting the merge history.</p><button className="secondary" onClick={() => undoMerge(item.id)}>Restore {item.title}</button></div>)}
    </div></details></section>
  </div>
}
