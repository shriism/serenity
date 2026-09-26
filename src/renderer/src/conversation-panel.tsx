import { useEffect, useState, type FormEvent } from 'react'
import type { Autonomy, Conversation, Message, Provider } from '../../shared/types'
import { AlertTriangle, ArrowUp, ChevronDown, FileText, Link2, MoreHorizontal } from 'lucide-react'
import { answerSegments, citationUri, type Citation } from '../../shared/citations'

/** Stored conversations are ordinary files; show only citations with the expected shape. */
function citationsOf(message: Message): Citation[] {
  return Array.isArray(message.citations) ? message.citations.filter((item): item is Citation =>
    Boolean(item) && typeof item.ref === 'string' && typeof item.title === 'string' && typeof item.sent === 'boolean') : []
}

function AnswerText({ message, onOpenResource }: { message: Message; onOpenResource(uri: string, side: boolean): void }) {
  const citations = citationsOf(message)
  if (!citations.length) return <p>{message.text}</p>
  const open = (citation: Citation, side: boolean): void => { const uri = citationUri(citation.ref); if (uri) onOpenResource(uri, side) }
  return <>
    <p>{answerSegments(message.text, citations.length).map((segment, index) => 'text' in segment ? segment.text :
      <button key={index} className={`citation-marker ${citations[segment.citation - 1].sent ? '' : 'unverified'}`} title={citations[segment.citation - 1].title}
        aria-label={`Source ${segment.citation}: ${citations[segment.citation - 1].title}`} onClick={(event) => open(citations[segment.citation - 1], event.metaKey || event.ctrlKey)}>{segment.citation}</button>)}</p>
    <ol className="citations" aria-label="Sources">{citations.map((citation, index) => <li key={citation.ref} className={citation.sent ? '' : 'unverified'}>
      <span className="citation-number">{index + 1}</span>
      <div>
        {citationUri(citation.ref) ? <button className="citation-title" onClick={(event) => open(citation, event.metaKey || event.ctrlKey)}>{citation.title}</button> : <strong className="citation-title">{citation.title}</strong>}
        {citation.quote && <q className={citation.quoteFound ? '' : 'unmatched'}>{citation.quote}</q>}
        {!citation.sent ? <small><AlertTriangle size={11}/> Not among the records shared for this answer — unverified</small> :
          citation.quote && !citation.quoteFound ? <small><AlertTriangle size={11}/> Quote not found in this record</small> : null}
      </div>
    </li>)}</ol>
  </>
}

interface Props {
  conversation?: Conversation
  provider: Provider
  onProviderChange(provider: Provider): void
  autonomy: Autonomy
  onAutonomyChange(autonomy: Autonomy): void
  retained: boolean
  onRetentionChange(retained: boolean): void
  message: string
  onMessageChange(message: string): void
  busy: boolean
  onSend(event: FormEvent): void
  onCancel(): void
  onDelete(): void
  activeFile?: { name: string; path: string; kind: 'entity' | 'document' | 'page'; allowed: boolean }
  openFileCount: number
  /** Opens a cited record; `side` opens it in the other editor group. */
  onOpenResource(uri: string, side: boolean): void
}

export function ConversationPanel(props: Props) {
  const [thinkingPhase, setThinkingPhase] = useState(0)
  useEffect(() => {
    if (!props.busy) return
    setThinkingPhase(0)
    const timer = window.setInterval(() => setThinkingPhase((phase) => (phase + 1) % 3), 3200)
    return () => window.clearInterval(timer)
  }, [props.busy])
  const thinkingText = ['Thinking…', 'Finding connections…', 'Putting it together…'][thinkingPhase]
  return <section className="conversation-panel">
    {props.conversation && <div className="conversation-header">
      <h2 title={props.conversation.title}>{props.conversation.title}</h2>
      <details className="conversation-menu"><summary title="Conversation actions" aria-label="Conversation actions"><MoreHorizontal size={18}/></summary><div><button onClick={props.onDelete}>Delete conversation</button></div></details>
    </div>}
    {props.activeFile && <div className="ai-context-strip" title={props.activeFile.path}>
      {props.activeFile.kind === 'entity' ? <Link2 size={14}/> : <FileText size={14}/>}
      <span><strong>{props.activeFile.name}</strong><small>{props.activeFile.allowed ? `Current ${props.activeFile.kind} · available when relevant${props.openFileCount > 1 ? ` · ${props.openFileCount - 1} other open` : ''}` : 'Not in this conversation’s selected read scope'}</small></span>
    </div>}
    {!props.activeFile && props.openFileCount > 0 && <div className="ai-context-strip"><FileText size={14}/><span><strong>{props.openFileCount} open {props.openFileCount === 1 ? 'file' : 'files'}</strong><small>Permitted open files can inform relevant answers</small></span></div>}
    <div className="messages">
      {!props.conversation && <div className="conversation-intro">
        <h1>{props.activeFile ? `Explore ${props.activeFile.name}.` : 'Think together.'}</h1>
        <p>{props.activeFile?.allowed ? 'This file can inform your next question.' : 'Ask about what’s here. Suggested changes come to you for review.'}</p>
      </div>}
      {props.conversation?.messages.map((item) => <article key={item.id} className={`message ${item.role}`}>
        <small>{item.role === 'assistant' ? item.provider : 'You'}</small>{item.role === 'assistant' ? <AnswerText message={item} onOpenResource={props.onOpenResource}/> : <p>{item.text}</p>}
        {item.sharedContext?.map((context, index) => <details className="context-inspector" key={index}>
          <summary>Context sent to {item.provider} · pass {index + 1} · {context.records.length} of {context.availableCount} permitted records</summary>
          <p>{context.readScopeMode === 'selected'
            ? 'Only this workflow’s selected knowledge and conversation were available for this request.'
            : context.mode === 'retrieved'
              ? 'Relevant records were selected from the accessible workspace. Other records remain available for retrieval.'
              : 'All workspace records were supplied.'} {context.catalogShown < context.availableCount ? `${context.catalogShown} catalog entries shown.` : ''}</p>
          {context.records.map((record) => <div key={record.ref}>
            <strong>{record.title}</strong>
            <small>{record.ref} · {record.sentCharacters}/{record.totalCharacters} characters · excerpt starts at {record.startCharacter} · SHA-256 {record.checksum.slice(0, 16)}…</small>
          </div>)}
        </details>)}
      </article>)}
      {props.busy && <div className="ai-thinking" role="status" aria-label={`${props.provider} is responding`}><span className="thinking-mark" aria-hidden="true"><i/><i/><i/></span><span aria-hidden="true">{thinkingText}</span></div>}
    </div>
    <form className="compose" onSubmit={props.onSend}>
      <div className="compose-input">
        <textarea value={props.message} onChange={(event) => props.onMessageChange(event.target.value)} placeholder="Ask Serenity…" disabled={props.busy} aria-label="Message"/>
        <div className="compose-actions">
          {props.busy && <button type="button" className="text-button" onClick={props.onCancel}>Cancel</button>}
          <button type="submit" className="primary" disabled={props.busy || !props.message.trim()} aria-label="Send message" title="Send message"><ArrowUp size={18}/></button>
        </div>
      </div>
      <details className="compose-options"><summary>{props.provider === 'copilot' ? 'GitHub Copilot' : 'OpenAI Codex'} <span>·</span> {props.autonomy === 'propose' ? 'Read & propose' : props.autonomy === 'ask' ? 'Ask first' : 'Auto-save permitted'} <ChevronDown size={13}/></summary>
        <div className="compose-settings">
          <label>Provider <select value={props.provider} onChange={(event) => props.onProviderChange(event.target.value as Provider)}>
            <option value="copilot">GitHub Copilot</option><option value="codex">OpenAI Codex</option>
          </select></label>
          <label>Autonomy <select value={props.autonomy} onChange={(event) => props.onAutonomyChange(event.target.value as Autonomy)}>
            <option value="ask">Ask first</option><option value="propose">Read & propose</option><option value="autonomous">Auto-save permitted proposals</option>
          </select></label>
          <label className="retention"><input type="checkbox" checked={props.retained} onChange={(event) => props.onRetentionChange(event.target.checked)}/> Save history</label>
        </div>
      </details>
    </form>
  </section>
}
