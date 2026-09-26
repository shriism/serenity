import { useEffect, useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { ProposalCard, type ProposalActions } from './proposal-card'

export function DocumentPreview({ name, workspace, onOpen, onError, ...actions }: ProposalActions & { name: string; workspace: WorkspaceSnapshot; onOpen(name: string): void; onError(message: string): void }) {
  const suggestions = workspace.proposals.filter((item) => item.source === name)
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.recordedAt.localeCompare(a.recordedAt))
  const pending = suggestions.filter((item) => item.status === 'pending').length
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let current = true
    setLoading(true)
    setContent(null)
    window.serenity.readDocument(name).then((text) => { if (current) setContent(text) })
      .catch((error) => { if (current) onError(String(error)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [name])
  return <section className="document-preview page">
    <header className="document-preview-header"><div><span className="eyebrow">WORKSPACE / DOCUMENTS</span><h1>{name}</h1><p>Stored in documents/{name}</p></div>
      <button className="secondary" onClick={() => onOpen(name)}><ExternalLink size={15}/> Open in default app</button></header>
    <div className={suggestions.length ? 'document-with-suggestions' : undefined}>
      {loading ? <p className="hint">Reading document…</p> : content === null ? <div className="document-empty"><FileText size={26}/><p>Preview unavailable for this format.</p><button onClick={() => onOpen(name)}>Open in default app</button></div> :
        <article className="document-text" aria-label={`Text extracted from ${name}`}>{content || 'This document contains no extractable text.'}</article>}
      {suggestions.length > 0 && <aside className="document-suggestions" aria-label={`Suggestions from ${name}`}>
        <h2>Suggested from this document</h2>
        <small>{pending ? `${pending} waiting for your review` : 'All decided'} · check each against the text</small>
        {suggestions.map((item) => <ProposalCard key={item.id} item={item} workspace={workspace} showSource={false} {...actions}/>)}
      </aside>}
    </div>
  </section>
}
