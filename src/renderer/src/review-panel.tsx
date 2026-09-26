import { Columns2 } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { proposalsBySource } from '../../shared/proposals'
import { resourceUri } from '../../shared/resources'
import { duplicateCandidates } from '../../shared/identity'
import type { Entity } from '../../shared/types'
import { ProposalCard, type ProposalActions } from './proposal-card'

const shownDuplicates = 12

export function ReviewPanel({ workspace, onOpenResource, onUpdate, onError, ...actions }: ProposalActions & {
  workspace: WorkspaceSnapshot
  onOpenResource(uri: string, side: boolean): void
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
}) {
  const sources = proposalsBySource(workspace.proposals)
  const duplicates = duplicateCandidates(workspace)
  const entityUri = (entity: Entity): string => resourceUri({ kind: 'entity', id: entity.id })
  async function keep(survivor: Entity, duplicate: Entity): Promise<void> {
    if (!window.confirm(`Archive ${duplicate.title} and link its claims to ${survivor.title}? The archived file and merge record remain, and the merge can be undone.`)) return
    try { onUpdate(await window.serenity.mergeEntities(duplicate.id, survivor.id)); onError('') }
    catch (error) { onError(String(error)) }
  }
  return <section className="page">
    <span className="eyebrow">KNOWLEDGE REVIEW</span><h1>Proposals & activity</h1>
    <p>Decide which suggested knowledge belongs in your workspace. Suggestions are grouped by their source; previous decisions remain visible.</p>
    {duplicates.length > 0 && <section className="review-source" aria-label="Possible duplicates">
      <header className="review-source-header"><div><h2>Same identity?</h2><small>{duplicates.length} possible {duplicates.length === 1 ? 'duplicate' : 'duplicates'} · similar names are not proof</small></div></header>
      {duplicates.slice(0, shownDuplicates).map(({ a, b, reasons }) => <article key={`${a.id}|${b.id}`} className="review-card duplicate-card">
        <span className="eyebrow">{a.type} · {b.type}</span>
        <h2>{a.title} <span aria-hidden="true">·</span> {b.title}</h2>
        <ul className="duplicate-reasons">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className="review-actions">
          <button className="secondary" onClick={() => { onOpenResource(entityUri(a), false); onOpenResource(entityUri(b), true) }}><Columns2 size={15}/> Compare side by side</button>
          <button className="secondary" onClick={() => void keep(a, b)}>Keep {a.title}</button>
          <button className="secondary" onClick={() => void keep(b, a)}>Keep {b.title}</button>
        </div>
      </article>)}
      {duplicates.length > shownDuplicates && <p className="hint">Showing the {shownDuplicates} strongest of {duplicates.length}.</p>}
    </section>}
    {sources.length === 0 && duplicates.length === 0 && <p className="hint">Nothing to review yet. Conversations can suggest claims, entities, tasks, and events.</p>}
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
