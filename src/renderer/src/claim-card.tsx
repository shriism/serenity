import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Claim, Entity, MergeRecord } from '../../shared/types'

interface Props {
  claim: Claim
  target?: Entity
  mergedFrom?: MergeRecord
  conflicting: boolean
  previousAlternative: boolean
  onSelectTarget(entity: Entity): void
  onMarkCurrent(id: string): void
  onRetract(id: string): void
}

export function ClaimCard({ claim, target, mergedFrom, conflicting, previousAlternative,
  onSelectTarget, onMarkCurrent, onRetract }: Props) {
  return <div className={`claim ${claim.status === 'retracted' ? 'retracted' : ''}`}>
    <span className="eyebrow">{claim.key} {claim.isCurrent ? '· CURRENT' : conflicting ? '· CONFLICT' : previousAlternative ? '· PREVIOUS ALTERNATIVE' : ''}</span>
    {target ? <button className="claim-link" onClick={() => onSelectTarget(target)}>{target.title} ↗</button> :
      claim.key === 'context' ? <details className="claim-context"><summary>Read attached context</summary>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ children }) => <span className="preview-link">{children}</span>,
          img: ({ alt }) => <span>[Image: {alt || 'no description'}]</span>
        }}>{claim.value}</ReactMarkdown>
      </details> : <strong>{claim.value}</strong>}
    <small>From {claim.source} · {claim.origin === 'human' ? 'direct statement' : claim.origin === 'ai-inference' ? 'AI inference' : 'AI extraction'} · {claim.status}
      {claim.confidence !== undefined ? ` · AI estimate ${Math.round(claim.confidence * 100)}%` : ''}
      {mergedFrom ? ` · archived from ${mergedFrom.title}` : ''}{claim.retractionReason ? ` · ${claim.retractionReason}` : ''}
    </small>
    {claim.status === 'confirmed' && <div className="claim-actions">
      <button onClick={() => onMarkCurrent(claim.id)}>{claim.isCurrent ? 'Change reason / reaffirm' : 'Mark current'}</button>
      <button onClick={() => onRetract(claim.id)}>Retract</button>
    </div>}
  </div>
}
