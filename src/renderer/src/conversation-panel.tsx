import type { FormEvent } from 'react'
import type { Autonomy, Conversation, Provider } from '../../shared/types'

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
}

export function ConversationPanel(props: Props) {
  return <section className="conversation-panel">
    <div className="conversation-header">
      <div><span className="eyebrow">HUMAN + AI</span><h2>{props.conversation?.title ?? 'New conversation'}</h2></div>
      {props.conversation && <button className="text-button" onClick={props.onDelete}>Delete conversation</button>}
    </div>
    <div className="messages">
      {!props.conversation && <div className="conversation-intro">
        <span className="welcome-symbol">✳</span><h1>Think together.</h1>
        <p>Ask about anything in your workspace. Changes to your knowledge arrive as proposals for review.</p>
      </div>}
      {props.conversation?.messages.map((item) => <article key={item.id} className={`message ${item.role}`}>
        <small>{item.role === 'assistant' ? item.provider : 'You'}</small><p>{item.text}</p>
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
      {props.busy && <p className="hint">{props.provider} is thinking…</p>}
    </div>
    <form className="compose" onSubmit={props.onSend}>
      <div className="compose-settings">
        <label>Provider <select value={props.provider} onChange={(event) => props.onProviderChange(event.target.value as Provider)}>
          <option value="copilot">GitHub Copilot</option><option value="codex">OpenAI Codex</option>
        </select></label>
        <label>Autonomy <select value={props.autonomy} onChange={(event) => props.onAutonomyChange(event.target.value as Autonomy)}>
          <option value="ask">Ask first</option><option value="propose">Read & propose</option><option value="autonomous">Auto-save permitted proposals</option>
        </select></label>
        <label className="retention"><input type="checkbox" checked={props.retained} onChange={(event) => props.onRetentionChange(event.target.checked)}/> Save history</label>
      </div>
      <div className="compose-input">
        <textarea value={props.message} onChange={(event) => props.onMessageChange(event.target.value)} placeholder="Ask a question or share something to remember..." disabled={props.busy} aria-label="Message"/>
        {props.busy && <button type="button" className="secondary" onClick={props.onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={props.busy || !props.message.trim()}>Send ↗</button>
      </div>
    </form>
  </section>
}
