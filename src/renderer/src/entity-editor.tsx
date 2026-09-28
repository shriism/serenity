import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { MessageCircle, Plus } from 'lucide-react'
import type { Claim, Entity, WorkspaceSnapshot } from '../../shared/types'
import { ClaimCard } from './claim-card'
import { sourceDocument } from '../../shared/provenance'
import { wikilinkMentions } from '../../shared/wikilinks'
import { resourceUri } from '../../shared/resources'
import { MarkdownEditor, type EditorContext, type EditorHandle } from './markdown-editor'
import { useAutosave } from './use-autosave'
import { ConflictBar, SaveIndicator } from './workspace-page'

export interface EntityEditorProps {
  workspace: WorkspaceSnapshot
  entityId: string
  context: EditorContext
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
  onOpenEntity(id: string): void
  onDiscuss(question: string): void
  onOpenSource(name: string): void
}

function claimSummary(allClaims: Claim[], selected: string) {
  const claims = allClaims.filter((item) => item.subject === selected)
  const incoming = allClaims.filter((item) => item.value === selected && item.subject !== selected && item.status === 'confirmed')
  const activeClaims = claims.filter((item) => item.status !== 'retracted')
  const conflicts = [...new Set(activeClaims.map((item) => item.key))].filter((key) => new Set(activeClaims.filter((item) => item.key === key).map((item) => item.value)).size > 1 && !activeClaims.some((item) => item.key === key && item.isCurrent))
  const resolvedKeys = [...new Set(activeClaims.filter((item) => item.isCurrent).map((item) => item.key))]
  return { claims, incoming, activeClaims, conflicts, resolvedKeys }
}
const emptyClaim = { key: '', value: '', source: 'Me' }

/** One entity: its name and type, its notes in live preview, and its sourced facts. Edits are saved as you go. */
export function EntityEditor(props: EntityEditorProps) {
  const { workspace, entityId: selected, onUpdate, onError } = props
  const stored = workspace.entities.find((entity) => entity.id === selected)!
  const saved = useMemo(() => ({ title: stored.title, type: stored.type, body: stored.body }), [stored.title, stored.type, stored.body])
  const { draft, setDraft, state, flush, resolve } = useAutosave({
    saved, revision: stored.revision, onUpdate, onError,
    revisionOf: (snapshot) => snapshot.entities.find((entity) => entity.id === selected)?.revision,
    save: (next, base) => window.serenity.saveEntity({ ...stored, title: next.title.trim() || stored.title, type: next.type.trim() || stored.type, body: next.body, revision: base } as Entity)
  })
  const [title, setTitle] = useState(draft.title)
  const [type, setType] = useState(draft.type)
  useEffect(() => setTitle(draft.title), [draft.title])
  useEffect(() => setType(draft.type), [draft.type])
  const [adding, setAdding] = useState(false)
  const notes = useRef<EditorHandle | null>(null)
  const [claim, setClaim] = useState(emptyClaim)
  const [claimTarget, setClaimTarget] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const id = useId()

  async function run(action: () => Promise<WorkspaceSnapshot>): Promise<WorkspaceSnapshot | null> {
    try { const next = await action(); onUpdate(next); onError(''); return next }
    catch (cause) { onError(String(cause)); return null }
  }

  async function commitTitle(): Promise<void> {
    const next = title.trim()
    if (!next) { setTitle(draft.title); return }
    if (next === draft.title) return
    // Links written by name would break on a rename, so find them before the old name stops resolving.
    const previous = draft.title
    const mentions = wikilinkMentions(workspace, resourceUri({ kind: 'entity', id: selected }))
    setDraft({ ...draft, title: next })
    await flush()
    if (mentions.length && window.confirm(`${mentions.length} ${mentions.length === 1 ? 'note links' : 'notes link'} to [[${previous}]]. Update ${mentions.length === 1 ? 'it' : 'them'} to [[${next}]]?`)) {
      try { onUpdate((await window.serenity.renameWikilinks(previous, next, mentions.map((mention) => mention.uri))).snapshot) }
      catch (cause) { onError(`Links were not updated: ${String(cause)}`) }
    }
  }

  function commitType(): void {
    const next = type.trim()
    if (!next) { setType(draft.type); return }
    if (next !== draft.type) { setDraft({ ...draft, type: next }); void flush() }
  }

  async function addClaim(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await run(() => window.serenity.addClaim({ ...claim, value: claimTarget || claim.value, subject: selected }))) {
      setClaim(emptyClaim)
      setClaimTarget('')
      setAdding(false)
    }
  }

  function retract(claimId: string): void {
    const reason = window.prompt('Why is this no longer current? The original stays in the history.')
    if (reason?.trim()) void run(() => window.serenity.retractClaim(claimId, reason))
  }

  function markCurrent(claimId: string): void {
    const reason = window.prompt('Why is this the current answer? Earlier claims stay visible.')
    if (reason?.trim()) void run(() => window.serenity.setCurrentClaim(claimId, reason))
  }

  function clearCurrent(key: string): void {
    if (window.confirm('Clear the current answer? Conflicting claims will need clarifying again.')) void run(() => window.serenity.clearCurrentClaim(selected, key))
  }

  async function merge(): Promise<void> {
    if (!mergeTarget) return
    await flush()
    const target = workspace.entities.find((entity) => entity.id === mergeTarget)
    if (!window.confirm(`Archive ${draft.title} and link its claims to ${target?.title}? The archived file and merge record stay in the workspace.`)) return
    if (await run(() => window.serenity.mergeEntities(selected, mergeTarget))) props.onOpenEntity(mergeTarget)
  }

  function undoMerge(source: string): void {
    const reason = window.prompt('Why restore this archived entity? The merge history stays visible.')
    if (reason?.trim()) void run(() => window.serenity.unmergeEntities(source, reason))
  }

  const { claims, incoming, activeClaims, conflicts, resolvedKeys } = useMemo(() => claimSummary(workspace.claims, selected), [workspace.claims, selected])
  const others = useMemo(() => workspace.entities.filter((entity) => entity.id !== selected), [workspace.entities, selected])
  const types = useMemo(() => [...new Set(workspace.entities.map((entity) => entity.type).filter(Boolean))].sort(), [workspace.entities])
  const titleOf = (entityId: string): string => workspace.entities.find((entity) => entity.id === entityId)?.title ?? entityId

  return <article className="document-view entity-document" aria-label={draft.title}>
    <SaveIndicator state={state}/>
    <ConflictBar state={state} what="entity" onResolve={resolve}/>
    <input className="inline-title" value={title} aria-label="Name" spellCheck={false}
      onChange={(event) => setTitle(event.target.value)} onBlur={() => void commitTitle()}
      onKeyDown={(event) => {
        // Enter continues into the notes, as in a document editor; Escape puts the name back.
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); notes.current?.focusStart() }
        else if (event.key === 'Escape') { setTitle(draft.title); event.currentTarget.blur() }
      }}/>
    <div className="properties">
      <label className="property" htmlFor={`${id}-type`}><span className="property-key">Type</span>
        <input id={`${id}-type`} className="property-value" value={type} list={`${id}-types`} onChange={(event) => setType(event.target.value)} onBlur={commitType}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}/></label>
      <datalist id={`${id}-types`}>{types.map((item) => <option key={item} value={item}/>)}</datalist>
      {stored.source && <div className="property"><span className="property-key">Source</span><span className="property-value static">{stored.source}</span></div>}
    </div>
    <MarkdownEditor handle={notes} value={draft.body} onChange={(body) => setDraft({ ...draft, body })} onBlur={() => void flush()} context={props.context}
      label={`Notes about ${draft.title}`} placeholder="Write what you know in your own words. Type [[ to link a page, entity, or document."/>

    <section className="facts" aria-labelledby={`${id}-facts`}>
      <header className="section-header"><h2 id={`${id}-facts`}>Facts</h2><span className="count">{claims.length}</span>
        <button type="button" className="icon-btn" onClick={() => setAdding((value) => !value)} aria-label="Add a fact" title="Add a fact" aria-expanded={adding}><Plus size={15}/></button></header>
      {resolvedKeys.map((key) => {
        const choice = activeClaims.find((item) => item.key === key && item.isCurrent)!
        const decision = [...workspace.resolutions].reverse().find((item) => item.subject === selected && item.key === key && item.currentClaimId === choice.id)
        return <div className="callout" key={key}><span><strong>Current {key}: {titleOf(choice.value)}</strong> · {decision?.reason ?? 'chosen by you'}. Earlier claims stay below.</span>
          <button className="text-button" onClick={() => clearCurrent(key)}>Undo</button></div>
      })}
      {conflicts.map((key) => {
        const possible = activeClaims.filter((item) => item.key === key)
        const human = possible.filter((item) => item.origin === 'human')
        const likely = human.length === 1 ? human[0] : null
        return <div className="callout warning" key={key}><span><strong>Conflicting {key}.</strong> {likely ? `Your own statement suggests ${titleOf(likely.value)}; this isn’t resolved yet.` : 'The sources disagree. Mark one as current, or ask.'}</span>
          <button className="text-button" onClick={() => props.onDiscuss(`I have conflicting information about ${draft.title}'s ${key}. What do the sources say, and what should I clarify?`)}><MessageCircle size={13}/> Discuss</button></div>
      })}
      {adding && <form className="fact-form" onSubmit={(event) => void addClaim(event)}>
        <input aria-label="Fact" placeholder="Fact, e.g. birthday or works with" required value={claim.key} onChange={(event) => setClaim({ ...claim, key: event.target.value })} autoFocus/>
        <input aria-label="Value" placeholder="Value" required={!claimTarget} disabled={Boolean(claimTarget)} value={claim.value} onChange={(event) => setClaim({ ...claim, value: event.target.value })}/>
        <select aria-label="Or link another entity" value={claimTarget} onChange={(event) => setClaimTarget(event.target.value)}>
          <option value="">or link an entity…</option>{others.map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}
        </select>
        <input aria-label="Source" placeholder="Source" required value={claim.source} onChange={(event) => setClaim({ ...claim, source: event.target.value })}/>
        <div className="form-buttons"><button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button><button type="submit" className="primary">Add fact</button></div>
      </form>}
      {claims.map((item) => <ClaimCard key={item.id} claim={item} target={workspace.entities.find((entity) => entity.id === item.value)}
        archivedTarget={workspace.archivedEntities.find((entity) => entity.id === item.value && entity.archived)?.title} mergedFrom={workspace.merges.find((merge) => merge.id === item.mergedFrom)}
        conflicting={conflicts.includes(item.key)} previousAlternative={resolvedKeys.includes(item.key) && !item.isCurrent} sourceDocument={sourceDocument(item.source, workspace.documents) ?? undefined}
        onOpenSource={props.onOpenSource} onSelectTarget={(entity) => props.onOpenEntity(entity.id)} onMarkCurrent={markCurrent} onRetract={retract}/>)}
      {claims.length === 0 && !adding && <p className="hint">No facts yet. Add one with its source, such as a birthday or who {draft.title} works with.</p>}
    </section>

    {incoming.length > 0 && <section className="facts" aria-label="Linked from other entities">
      <header className="section-header"><h2>Linked from</h2><span className="count">{incoming.length}</span></header>
      {incoming.map((link) => <div className="fact" key={link.id}><span className="fact-key">{link.key}</span>
        <div className="fact-value"><button className="text-button link" onClick={() => props.onOpenEntity(link.subject)}>{titleOf(link.subject)}</button></div></div>)}
    </section>}

    {workspace.merges.filter((item) => item.target === selected).map((item) => <div className="callout" key={item.id}>
      <span><strong>{item.title}</strong> was merged into this entity. Its file and links can be restored without losing the merge history.</span>
      <button className="secondary" onClick={() => undoMerge(item.id)}>Restore {item.title}</button></div>)}

    {others.length > 0 && <details className="quiet-details">
      <summary>Same as another entity?</summary>
      <p className="hint">Archive this entity and point its facts and links at the one you choose. Its file and history stay in the workspace, and the merge can be undone.</p>
      <div className="inline-form"><select aria-label="Merge into" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
        <option value="">Choose the entity to keep</option>{others.map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select>
        <button className="secondary" disabled={!mergeTarget} onClick={() => void merge()}>Merge</button></div>
    </details>}
  </article>
}
