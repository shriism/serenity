import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Proposal, WorkspaceSnapshot } from '../../shared/types'
import { identityCandidates } from '../../shared/identity'
import { sourceDocument } from '../../shared/provenance'

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
  const [attaching, setAttaching] = useState(false)
  const matches = item.kind === 'entity' ? identityCandidates(item.title, item.type, workspace.entities) : []
  return <article className="review-card">
    <span className="eyebrow">{item.status === 'pending' ? 'Waiting for review' : item.status === 'accepted' ? 'Accepted' : 'Dismissed'} · {item.kind === 'claim' ? 'fact' : item.kind} suggested by {item.provider === 'codex' ? 'Codex' : item.provider === 'copilot' ? 'Copilot' : item.provider}{item.origin === 'ai-inference' ? ', inferred' : ''}</span>
    <h2>{item.kind === 'claim' ? `${workspace.entities.find((entity) => entity.id === item.subject)?.title ?? 'Unknown entity'} · ${item.key}` : item.title}</h2>
    <strong>{item.kind === 'claim' ? workspace.entities.find((entity) => entity.id === item.value)?.title ?? item.value : item.kind === 'entity' ? `Suggested category: ${item.type}` : item.kind === 'task' ? `Due ${item.due ?? 'not set'}` : `Starts ${item.start}`}</strong>
    {(showSource || (item.kind === 'claim' && item.confidence !== undefined)) && <p>{showSource ? `Source: ${item.source}` : ''}{showSource && item.kind === 'claim' && item.confidence !== undefined ? ' · ' : ''}{item.kind === 'claim' && item.confidence !== undefined ? `AI-estimated confidence: ${Math.round(item.confidence * 100)}%` : ''}</p>}
    {showSource && sourceDocument(item.source, workspace.documents) && <button className="text-button" onClick={() => onOpenSource(sourceDocument(item.source, workspace.documents)!)}>Open source document ↗</button>}
    {item.kind === 'entity' && item.body.trim() && <div className="review-context"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      a: ({ children }) => <span className="preview-link">{children}</span>, img: ({ alt }) => <span>[Image: {alt || 'no description'}]</span>
    }}>{item.body}</ReactMarkdown></div>}
    {item.kind === 'entity' && matches.length > 0 && <p className="review-warning">Possible match: {matches.map(({ entity }) => entity.title).join(', ')}. Decide whether this is new or belongs to an existing entity.</p>}
    {item.resolvedInto && <p>Attached to {workspace.entities.find((entity) => entity.id === item.resolvedInto)?.title ?? item.resolvedInto}.</p>}
    {item.createdEntityId && <p>Created as {workspace.entities.find((entity) => entity.id === item.createdEntityId)?.title ?? item.createdEntityId}.</p>}
    {item.status === 'pending' && item.kind === 'entity' && attaching && <div className="review-identity">
      <label htmlFor={`attach-${item.id}`}>Add what was suggested to an existing entity, as a sourced note, instead of creating a new one</label>
      {matches.length > 0 && <div className="review-matches">{matches.slice(0, 3).map(({ entity }) =>
        <button key={entity.id} type="button" className="secondary" onClick={() => onAttach(item.id, entity.id)}>Add to {entity.title}</button>)}</div>}
      <div className="inline-form"><select id={`attach-${item.id}`} value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">{matches.length ? 'Or choose another entity' : 'Choose an entity'}</option>
        {workspace.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.title} · {entity.type}</option>)}
      </select>
      <button className="secondary" disabled={!target} onClick={() => onAttach(item.id, target)}>Add</button></div>
    </div>}
    {item.status === 'pending' && <div className="review-actions">
      <button className="primary" onClick={() => onResolve(item.id, true)}>{item.kind === 'entity' ? 'Create entity' : 'Accept'}</button>
      {item.kind === 'entity' && workspace.entities.length > 0 && <button className="secondary" aria-expanded={attaching} onClick={() => setAttaching((value) => !value)}>Add to existing…</button>}
      <button className="secondary" onClick={() => onResolve(item.id, false)}>Dismiss</button>
    </div>}
  </article>
}
