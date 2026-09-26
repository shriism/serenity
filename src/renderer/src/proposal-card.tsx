import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Proposal, WorkspaceSnapshot } from '../../shared/types'
import { identityCandidates } from '../../shared/identity'

export interface ProposalActions {
  onResolve(id: string, accept: boolean): void
  onAttach(proposalId: string, entityId: string): void
  onOpenSource(name: string): void
}

/** One AI-proposed change with its evidence and the human's decision controls. */
export function ProposalCard({ item, workspace, showSource = true, onResolve, onAttach, onOpenSource }: ProposalActions & {
  item: Proposal
  workspace: WorkspaceSnapshot
  /** Hidden when the card is already shown beside its source. */
  showSource?: boolean
}) {
  const [target, setTarget] = useState('')
  const matches = item.kind === 'entity' ? identityCandidates(item.title, item.type, workspace.entities) : []
  return <article className="review-card">
    <span className="eyebrow">{item.status} · {item.kind} · {item.provider} · {item.origin}</span>
    <h2>{item.kind === 'claim' ? `${workspace.entities.find((entity) => entity.id === item.subject)?.title ?? 'Unknown entity'} · ${item.key}` : item.title}</h2>
    <strong>{item.kind === 'claim' ? workspace.entities.find((entity) => entity.id === item.value)?.title ?? item.value : item.kind === 'entity' ? `Suggested category: ${item.type}` : item.kind === 'task' ? `Due ${item.due ?? 'not set'}` : `Starts ${item.start}`}</strong>
    {(showSource || (item.kind === 'claim' && item.confidence !== undefined)) && <p>{showSource ? `Source: ${item.source}` : ''}{showSource && item.kind === 'claim' && item.confidence !== undefined ? ' · ' : ''}{item.kind === 'claim' && item.confidence !== undefined ? `AI-estimated confidence: ${Math.round(item.confidence * 100)}%` : ''}</p>}
    {showSource && workspace.documents.some((document) => document.name === item.source) && <button className="text-button" onClick={() => onOpenSource(item.source)}>Open source document ↗</button>}
    {item.kind === 'entity' && item.body.trim() && <div className="review-context"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      a: ({ children }) => <span className="preview-link">{children}</span>, img: ({ alt }) => <span>[Image: {alt || 'no description'}]</span>
    }}>{item.body}</ReactMarkdown></div>}
    {item.kind === 'entity' && matches.length > 0 && <p className="review-warning">Possible match: {matches.map(({ entity }) => entity.title).join(', ')}. Decide whether this is new or belongs to an existing entity.</p>}
    {item.resolvedInto && <p>Attached to {workspace.entities.find((entity) => entity.id === item.resolvedInto)?.title ?? item.resolvedInto}.</p>}
    {item.createdEntityId && <p>Created as {workspace.entities.find((entity) => entity.id === item.createdEntityId)?.title ?? item.createdEntityId}.</p>}
    {item.status === 'pending' && item.kind === 'entity' && <div className="review-identity">
      <label htmlFor={`attach-${item.id}`}>Attach sourced context to an existing entity</label>
      <select id={`attach-${item.id}`} value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">Choose an entity</option>
        {workspace.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.title} · {entity.type}</option>)}
      </select>
      <button className="secondary" disabled={!target} onClick={() => onAttach(item.id, target)}>Attach to selected entity</button>
    </div>}
    {item.status === 'pending' && <div className="review-actions">
      <button className="primary" onClick={() => onResolve(item.id, true)}>{item.kind === 'entity' ? 'Create separate entity' : 'Accept'}</button>
      <button className="secondary" onClick={() => onResolve(item.id, false)}>Dismiss</button>
    </div>}
  </article>
}
