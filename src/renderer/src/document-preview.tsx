import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { documentOutline } from '../../shared/document-outline'
import { ProposalCard, type ProposalActions } from './proposal-card'
import { citesDocument } from '../../shared/provenance'

// Rendering a whole book's text at once would freeze the pane; more can be revealed on request.
const previewStep = 150000

export function DocumentPreview({ name, workspace, onOpen, onError, ...actions }: ProposalActions & { name: string; workspace: WorkspaceSnapshot; onOpen(name: string): void; onError(message: string): void }) {
  const suggestions = workspace.proposals.filter((item) => citesDocument(item.source, name))
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.recordedAt.localeCompare(a.recordedAt))
  const pending = suggestions.filter((item) => item.status === 'pending').length
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [startOffset, setStartOffset] = useState(0)
  const [shownLength, setShownLength] = useState(previewStep)
  const [jumpTarget, setJumpTarget] = useState<number | null>(null)
  const textElement = useRef<HTMLElement>(null)
  const outline = useMemo(() => documentOutline(name, content ?? ''), [name, content])
  const shownText = content?.slice(startOffset, shownLength) ?? ''
  const textParts: ReactNode[] = []
  let position = 0
  outline.forEach((heading, index) => {
    if (heading.start < startOffset || heading.start >= shownLength) return
    const localStart = heading.start - startOffset
    const localEnd = Math.min(heading.end, shownLength) - startOffset
    textParts.push(shownText.slice(position, localStart))
    textParts.push(<span key={heading.start} data-outline-index={index}>{shownText.slice(localStart, localEnd)}</span>)
    position = localEnd
  })
  textParts.push(shownText.slice(position))
  useEffect(() => {
    if (jumpTarget === null || !outline[jumpTarget] || outline[jumpTarget].start < startOffset || outline[jumpTarget].start >= shownLength) return
    textElement.current?.querySelector<HTMLElement>(`[data-outline-index="${jumpTarget}"]`)?.scrollIntoView({ block: 'start' })
    setJumpTarget(null)
  }, [jumpTarget, startOffset, shownLength, outline])
  useEffect(() => {
    let current = true
    setLoading(true)
    setContent(null)
    setStartOffset(0)
    setShownLength(previewStep)
    setJumpTarget(null)
    window.serenity.readDocument(name).then((text) => { if (current) setContent(text) })
      .catch((error) => { if (current) onError(String(error)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [name])
  return <section className="document-preview page">
    <header className="view-header"><div><h1>{name}</h1></div>
      <div className="view-actions"><button className="secondary" onClick={() => onOpen(name)}><ExternalLink size={14}/> Open in default app</button></div></header>
    <div className={suggestions.length ? 'document-with-suggestions' : undefined}>
      {loading ? <p className="hint">Reading document…</p> : content === null ? <div className="document-empty"><FileText size={26}/><p>Preview unavailable for this format.</p><button onClick={() => onOpen(name)}>Open in default app</button></div> :
        <div>{outline.length > 0 && <details className="document-outline"><summary>Outline · {outline.length} sections</summary>
          <nav aria-label={`Sections in ${name}`}><ol>{outline.map((heading, index) => <li key={heading.start}>
            <button type="button" style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }} onClick={() => {
              if (heading.start < startOffset || heading.start >= shownLength) { setStartOffset(heading.start); setShownLength(heading.start + previewStep) }
              setJumpTarget(index)
            }}>{heading.title}</button>
          </li>)}</ol></nav></details>}
        <article ref={textElement} className="document-text" aria-label={`Text extracted from ${name}`}>{content ? textParts : 'This document contains no extractable text.'}
          {content && (startOffset > 0 || content.length > shownLength) && <div className="document-more">
            <p className="hint">Showing {startOffset > 0 ? `${Math.round(startOffset / 1000)}k–` : ''}{Math.round(Math.min(shownLength, content.length) / 1000)}k of {Math.round(content.length / 1000)}k characters.</p>
            {startOffset > 0 && <button className="secondary" onClick={() => { setStartOffset(0); setShownLength(previewStep) }}>Start of document</button>}
            {content.length > shownLength && <button className="secondary" onClick={() => setShownLength((length) => length + previewStep)}>Show more</button>}
          </div>}</article></div>}
      {suggestions.length > 0 && <aside className="document-suggestions" aria-label={`Suggestions from ${name}`}>
        <h2>Suggested from this document</h2>
        <small>{pending ? `${pending} waiting for your review` : 'All decided'} · check each against the text</small>
        {suggestions.map((item) => <ProposalCard key={item.id} item={item} workspace={workspace} showSource={false} {...actions}/>)}
      </aside>}
    </div>
  </section>
}
