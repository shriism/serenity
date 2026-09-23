import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkspaceSnapshot } from '../../shared/types'
import { identityCandidates } from '../../shared/identity'

interface Props {
  workspace: WorkspaceSnapshot
  onResolve(id: string, accept: boolean): void
  onAttach(proposalId: string, entityId: string): void
  onOpenSource(name: string): void
}

export function ReviewPanel({ workspace, onResolve, onAttach, onOpenSource }: Props) {
  const [targets, setTargets] = useState<Record<string, string>>({})
  const ordered = [...workspace.proposals].sort((a, b) =>
    Number(b.status === 'pending') - Number(a.status === 'pending') || b.recordedAt.localeCompare(a.recordedAt))

  return <section className="page">
    <span className="eyebrow">KNOWLEDGE REVIEW</span><h1>Proposals & activity</h1>
    <p>Decide which suggested knowledge belongs in your workspace. Previous decisions remain visible.</p>
    {ordered.length === 0 && <p className="hint">Nothing to review yet. Conversations can suggest claims, entities, tasks, and events.</p>}
    {ordered.map((item) => {
      const matches = item.kind === 'entity' ? identityCandidates(item.title, item.type, workspace.entities) : []
      return <article key={item.id} className="review-card">
        <span className="eyebrow">{item.status} · {item.kind} · {item.provider} · {item.origin}</span>
        <h2>{item.kind === 'claim' ? `${workspace.entities.find((entity) => entity.id === item.subject)?.title ?? 'Unknown entity'} · ${item.key}` : item.title}</h2>
        <strong>{item.kind === 'claim' ? item.value : item.kind === 'entity' ? `Suggested category: ${item.type}` : item.kind === 'task' ? `Due ${item.due ?? 'not set'}` : `Starts ${item.start}`}</strong>
        <p>Source: {item.source}{item.kind === 'claim' && item.confidence !== undefined ? ` · AI-estimated confidence: ${Math.round(item.confidence * 100)}%` : ''}</p>
        {workspace.documents.some((document) => document.name === item.source) && <button className="text-button" onClick={() => onOpenSource(item.source)}>Open source document ↗</button>}
        {item.kind === 'entity' && item.body.trim() && <div className="review-context"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ children }) => <span className="preview-link">{children}</span>, img: ({ alt }) => <span>[Image: {alt || 'no description'}]</span>
        }}>{item.body}</ReactMarkdown></div>}
        {item.kind === 'entity' && matches.length > 0 && <p className="review-warning">Possible match: {matches.map(({ entity }) => entity.title).join(', ')}. Decide whether this is new or belongs to an existing entity.</p>}
        {item.resolvedInto && <p>Attached to {workspace.entities.find((entity) => entity.id === item.resolvedInto)?.title ?? item.resolvedInto}.</p>}
        {item.createdEntityId && <p>Created as {workspace.entities.find((entity) => entity.id === item.createdEntityId)?.title ?? item.createdEntityId}.</p>}
        {item.status === 'pending' && item.kind === 'entity' && <div className="review-identity">
          <label htmlFor={`attach-${item.id}`}>Attach sourced context to an existing entity</label>
          <select id={`attach-${item.id}`} value={targets[item.id] ?? ''} onChange={(event) => setTargets({ ...targets, [item.id]: event.target.value })}>
            <option value="">Choose an entity</option>
            {workspace.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.title} · {entity.type}</option>)}
          </select>
          <button className="secondary" disabled={!targets[item.id]} onClick={() => onAttach(item.id, targets[item.id])}>Attach to selected entity</button>
        </div>}
        {item.status === 'pending' && <div className="review-actions">
          <button className="primary" onClick={() => onResolve(item.id, true)}>{item.kind === 'entity' ? 'Create separate entity' : 'Accept'}</button>
          <button className="secondary" onClick={() => onResolve(item.id, false)}>Dismiss</button>
        </div>}
      </article>
    })}
  </section>
}
