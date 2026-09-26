import { Columns2 } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { proposalsBySource } from '../../shared/proposals'
import { resourceUri } from '../../shared/resources'
import { ProposalCard, type ProposalActions } from './proposal-card'

export function ReviewPanel({ workspace, onOpenResource, ...actions }: ProposalActions & {
  workspace: WorkspaceSnapshot
  onOpenResource(uri: string, side: boolean): void
}) {
  const sources = proposalsBySource(workspace.proposals)
  return <section className="page">
    <span className="eyebrow">KNOWLEDGE REVIEW</span><h1>Proposals & activity</h1>
    <p>Decide which suggested knowledge belongs in your workspace. Suggestions are grouped by their source; previous decisions remain visible.</p>
    {sources.length === 0 && <p className="hint">Nothing to review yet. Conversations can suggest claims, entities, tasks, and events.</p>}
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
