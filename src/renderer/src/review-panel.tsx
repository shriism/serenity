import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns2 } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { proposalsBySource } from '../../shared/proposals'
import { resourceUri } from '../../shared/resources'
import { distinctRepresentatives, duplicateCandidates } from '../../shared/identity'
import type { Entity } from '../../shared/types'
import { ProposalCard, type ProposalActions } from './proposal-card'

export function ReviewPanel({ workspace, onOpenResource, onUpdate, onError, ...actions }: ProposalActions & {
  workspace: WorkspaceSnapshot
  onOpenResource(uri: string, side: boolean): void
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
}) {
  const sources = proposalsBySource(workspace.proposals)
  const [shownDuplicates, setShownDuplicates] = useState(12)
  const [shownDecisions, setShownDecisions] = useState(12)
  const [focusTarget, setFocusTarget] = useState<{ kind: 'decision' | 'candidate'; key: string; generation: number } | null>(null)
  const reviewRef = useRef<HTMLElement>(null)
  const entities = useMemo(() => new Map(workspace.entities.map((entity) => [entity.id, entity])), [workspace.entities])
  // Recomputed only when the entities, claims, or merge history change, not on every render.
  const duplicates = useMemo(() => duplicateCandidates(workspace), [workspace.entities, workspace.claims, workspace.mergeHistory, workspace.merges, workspace.identityDecisions])
  const distinct = workspace.identityDecisions.filter((item) => !item.undoneAt && distinctRepresentatives(item, workspace.merges).every((id) => entities.has(id)))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
  const entityUri = (entity: Entity): string => resourceUri({ kind: 'entity', id: entity.id })
  useEffect(() => {
    if (!focusTarget || workspace.generation < focusTarget.generation) return
    const selector = focusTarget.kind === 'decision' ? `[data-decision-id="${focusTarget.key}"] button` :
      `[data-identity-pair="${focusTarget.key}"] button:last-child`
    ;(reviewRef.current?.querySelector<HTMLElement>(selector) ?? reviewRef.current?.querySelector<HTMLElement>('h1'))?.focus()
    setFocusTarget(null)
  }, [focusTarget, workspace.generation])
  async function keep(survivor: Entity, duplicate: Entity): Promise<void> {
    if (!window.confirm(`Archive ${duplicate.title} and link its claims to ${survivor.title}? The archived file and merge record remain, and the merge can be undone.`)) return
    try { onUpdate(await window.serenity.mergeEntities(duplicate.id, survivor.id)); onError('') }
    catch (error) { onError(String(error)) }
  }
  async function markDistinct(a: Entity, b: Entity): Promise<void> {
    if (!window.confirm(`Record that ${a.title} and ${b.title} are different identities? This removes the duplicate suggestion. You can undo the decision here later.`)) return
    try {
      const next = await window.serenity.markDistinctEntities(a.id, b.id)
      onUpdate(next)
      const decision = next.identityDecisions.find((item) => !item.undoneAt && [item.left, item.right].sort().join('|') === [a.id, b.id].sort().join('|'))
      if (decision) setFocusTarget({ kind: 'decision', key: decision.id, generation: next.generation })
      onError('')
    }
    catch (error) { onError(String(error)) }
  }
  async function undoDistinct(id: string): Promise<void> {
    try {
      const decision = workspace.identityDecisions.find((item) => item.id === id)
      const next = await window.serenity.undoIdentityDecision(id)
      onUpdate(next)
      if (decision) {
        const key = distinctRepresentatives(decision, next.merges).sort().join('|')
        const position = duplicateCandidates(next).findIndex(({ a, b }) => [a.id, b.id].sort().join('|') === key)
        if (position >= shownDuplicates) setShownDuplicates(Math.ceil((position + 1) / 12) * 12)
        setFocusTarget({ kind: 'candidate', key, generation: next.generation })
      }
      onError('')
    }
    catch (error) { onError(String(error)) }
  }
  return <section className="page" ref={reviewRef}>
    <span className="eyebrow">KNOWLEDGE REVIEW</span><h1 tabIndex={-1}>Proposals & activity</h1>
    <p>Decide which suggested knowledge belongs in your workspace. Suggestions are grouped by their source; previous decisions remain visible.</p>
    {duplicates.length > 0 && <section className="review-source" aria-label="Possible duplicates">
      <header className="review-source-header"><div><h2>Same identity?</h2><small>{duplicates.length} possible {duplicates.length === 1 ? 'duplicate' : 'duplicates'} · similar names are not proof</small></div></header>
      {duplicates.slice(0, shownDuplicates).map(({ a, b, reasons }) => <article key={`${a.id}|${b.id}`} data-identity-pair={[a.id, b.id].sort().join('|')} className="review-card duplicate-card">
        <span className="eyebrow">{a.type} · {b.type}</span>
        <h2>{a.title} <span aria-hidden="true">·</span> {b.title}</h2>
        <ul className="duplicate-reasons">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className="review-actions">
          <button className="secondary" onClick={() => { onOpenResource(entityUri(a), false); onOpenResource(entityUri(b), true) }}><Columns2 size={15}/> Compare side by side</button>
          <button className="secondary" onClick={() => void keep(a, b)}>Keep {a.title}</button>
          <button className="secondary" onClick={() => void keep(b, a)}>Keep {b.title}</button>
          <button className="secondary" onClick={() => void markDistinct(a, b)}>Mark as distinct</button>
        </div>
      </article>)}
      {duplicates.length > shownDuplicates && <button className="text-button" onClick={() => setShownDuplicates((count) => count + 12)}>Show more possible duplicates ({duplicates.length - shownDuplicates} remaining)</button>}
    </section>}
    {distinct.length > 0 && <section className="review-source" aria-label="Distinct identity decisions">
      <header className="review-source-header"><div><h2>Marked as distinct</h2><small>{distinct.length} {distinct.length === 1 ? 'decision' : 'decisions'} · stored in this workspace</small></div></header>
      {distinct.slice(0, shownDecisions).map((decision) => {
        const [leftId, rightId] = distinctRepresentatives(decision, workspace.merges)
        const left = entities.get(leftId)!
        const right = entities.get(rightId)!
        return <article key={decision.id} data-decision-id={decision.id} className="review-card distinct-card">
          <h3>{left.title} <span aria-hidden="true">·</span> {right.title}</h3>
          <p>These remain separate identities{leftId !== decision.left || rightId !== decision.right ? ', including records merged into them' : ''}. Undo to review them again.</p>
          <button className="text-button" onClick={() => void undoDistinct(decision.id)}>Undo decision</button>
        </article>
      })}
      {distinct.length > shownDecisions && <button className="text-button" onClick={() => setShownDecisions((count) => count + 12)}>Show more decisions</button>}
    </section>}
    {sources.length === 0 && duplicates.length === 0 && distinct.length === 0 && <p className="hint">Nothing to review yet. Conversations can suggest claims, entities, tasks, and events.</p>}
    {sources.map(({ source, proposals, pending }) => {
      const document = workspace.documents.find((item) => item.name === source)
      return <section key={source} className="review-source" aria-label={`From ${source}`}>
        <header className="review-source-header">
          <div><h2>From {source}</h2><small>{pending ? `${pending} pending` : 'All decided'} · {proposals.length} {proposals.length === 1 ? 'suggestion' : 'suggestions'}</small></div>
          {document && <button className="secondary" onClick={() => onOpenResource(resourceUri({ kind: 'document', id: document.name }), true)}><Columns2 size={15}/> Review beside document</button>}
        </header>
        {proposals.map((item) => <ProposalCard key={item.id} item={item} workspace={workspace} showSource={!document} {...actions}/>)}
      </section>
    })}
  </section>
}
