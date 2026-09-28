import { MoreHorizontal } from 'lucide-react'
import type { Claim, Entity, MergeRecord } from '../../shared/types'
import { MenuButton } from './menu'

interface Props {
  claim: Claim
  target?: Entity
  mergedFrom?: MergeRecord
  conflicting: boolean
  previousAlternative: boolean
  onSelectTarget(entity: Entity): void
  onMarkCurrent(id: string): void
  onRetract(id: string): void
  /** The imported document this claim's source cites, if any. */
  sourceDocument?: string
  onOpenSource(name: string): void
}

const origins = { human: 'you said', 'ai-statement': 'AI extraction', 'ai-inference': 'AI inference' }

/** One sourced fact about an entity, with where it came from and what can be done with it. */
export function ClaimCard({ claim, target, mergedFrom, conflicting, previousAlternative,
  onSelectTarget, onMarkCurrent, onRetract, sourceDocument, onOpenSource }: Props) {
  const badge = claim.isCurrent ? 'Current' : conflicting ? 'Conflict' : previousAlternative ? 'Earlier answer' : claim.status === 'retracted' ? 'Retracted' : null
  return <div className={`fact ${claim.status === 'retracted' ? 'retracted' : ''} ${conflicting ? 'conflicting' : ''}`}>
    <span className="fact-key">{claim.key}</span>
    <div className="fact-value">
      {target ? <button className="text-button link" onClick={() => onSelectTarget(target)}>{target.title}</button> :
        claim.key === 'context' ? <details className="fact-context"><summary>Attached context</summary><p>{claim.value}</p></details> : <span>{claim.value}</span>}
      {badge && <span className={`badge ${badge === 'Conflict' ? 'warning' : badge === 'Current' ? 'accent' : ''}`}>{badge}</span>}
      <small className="fact-meta">
        {sourceDocument ? <button className="text-button" onClick={() => onOpenSource(sourceDocument)}>{claim.source}</button> : claim.source}
        {' · '}{origins[(claim.origin ?? 'human') as keyof typeof origins] ?? claim.origin}
        {claim.confidence !== undefined ? ` · ${Math.round(claim.confidence * 100)}% confident` : ''}
        {mergedFrom ? ` · from ${mergedFrom.title}` : ''}{claim.retractionReason ? ` · ${claim.retractionReason}` : ''}
      </small>
    </div>
    {claim.status === 'confirmed' && <MenuButton label={`Actions for ${claim.key}`} align="end" className="icon-btn fact-menu" items={[
      { id: 'current', label: claim.isCurrent ? 'Reaffirm as current…' : 'Mark as current answer…', run: () => onMarkCurrent(claim.id) },
      { id: 'retract', label: 'Retract…', danger: true, run: () => onRetract(claim.id) }
    ]}><MoreHorizontal size={15}/></MenuButton>}
  </div>
}
