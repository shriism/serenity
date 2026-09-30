import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, ArrowUp, ChevronDown, FileText, Lock, Search, Square, Star, Trash2 } from 'lucide-react'
import type { Autonomy, Conversation, Message, Provider, ReadScope, WorkflowPermissions, WorkspaceSnapshot } from '../../shared/types'
import { answerSegments, citationUri, type Citation } from '../../shared/citations'
import { MenuButton, useContextMenu } from './menu'
import { Dialog } from './dialog'
import { ResourcePicker } from './resource-picker'
import { ProposalCard, type ProposalActions } from './proposal-card'
import { chatGPTUsageURL, providerIds, providerLabels, providerName, providerShortLabels } from '../../shared/providers'

const autonomyNames: Record<Autonomy, string> = { ask: 'Ask first', propose: 'Read & propose', autonomous: 'Auto-save permitted' }

/** Stored conversations are ordinary files; show only citations with the expected shape. */
function citationsOf(message: Message): Citation[] {
  return Array.isArray(message.citations) ? message.citations.filter((item): item is Citation =>
    Boolean(item) && typeof item.ref === 'string' && typeof item.title === 'string' && typeof item.sent === 'boolean') : []
}

function AnswerText({ message, onOpenResource }: { message: Message; onOpenResource(uri: string, side: boolean): void }) {
  const citations = citationsOf(message)
  if (!citations.length) return <p className="message-text">{message.text}</p>
  const open = (citation: Citation, side: boolean): void => { const uri = citationUri(citation.ref); if (uri) onOpenResource(uri, side) }
  return <>
    <p className="message-text">{answerSegments(message.text, citations.length).map((segment, index) => 'text' in segment ? segment.text :
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

/** Everything the composer and conversation need from the assistant state. */
export interface AssistantState {
  conversationId: string | null
  conversation?: Conversation
  provider: Provider
  setProvider(provider: Provider): void
  autonomy: Autonomy
  setAutonomy(autonomy: Autonomy): void
  retained: boolean
  setRetained(retained: boolean): void
  permissions: WorkflowPermissions
  setPermissions(permissions: WorkflowPermissions): void
  readScope: ReadScope
  setReadScope(scope: ReadScope): void
  message: string
  setMessage(message: string): void
  busy: boolean
  /** The answer written so far while the provider streams it. */
  streamingText: string
  sendMessage(event: FormEvent): Promise<void>
  cancelMessage(): Promise<void>
  deleteConversation(id?: string): Promise<void>
  saveWorkflowSettings(): Promise<void>
  selectConversation(item: Conversation): void
}

export interface ActiveContext { name: string; path?: string; kind: string; allowed: boolean }

/** What the assistant can see, shown as small chips above the message field. */
export function ContextChips({ active, visiblePanes, openFiles }: { active?: ActiveContext; visiblePanes: number; openFiles: number }) {
  if (!active && !openFiles) return null
  return <div className="composer-context" aria-label="Context the assistant can use">
    {active && <span className={`context-chip ${active.allowed ? '' : 'blocked'}`} title={active.allowed ? `${active.path ?? active.name} · available when relevant` : 'Not in this conversation’s read scope'}>
      {active.allowed ? <FileText size={12}/> : <Lock size={12}/>}<span>{active.name}</span></span>}
    {visiblePanes > 0 && <span className="context-chip quiet">+{visiblePanes} {visiblePanes === 1 ? 'pane' : 'panes'} in view</span>}
    {!active && openFiles > 0 && <span className="context-chip quiet">{openFiles} open {openFiles === 1 ? 'tab' : 'tabs'}</span>}
  </div>
}

export function Composer({ assistant, placeholder = 'Ask Serenity…', context, onOpenSettings, autoFocus = false }: {
  assistant: AssistantState
  placeholder?: string
  context?: ReactNode
  onOpenSettings(): void
  autoFocus?: boolean
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`
  }, [assistant.message])
  useEffect(() => { if (autoFocus) field.current?.focus() }, [autoFocus, assistant.conversationId])
  const scope = assistant.readScope
  const scopeLabel = scope.mode === 'workspace' ? 'All files' : `${scope.entityIds.length + scope.documentNames.length} selected`
  return <form className="composer" onSubmit={(event) => void assistant.sendMessage(event)}>
    {context}
    <textarea ref={field} rows={1} value={assistant.message} onChange={(event) => assistant.setMessage(event.target.value)} placeholder={placeholder}
      aria-label="Message" disabled={assistant.busy}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }}/>
    <div className="composer-bar">
      <div className="composer-options">
        <MenuButton label="Provider" className="chip-btn" items={providerIds.map((provider) =>
          ({ id: provider, label: providerLabels[provider], checked: assistant.provider === provider, run: () => assistant.setProvider(provider) }))}>
          {providerShortLabels[assistant.provider]}<ChevronDown size={12}/></MenuButton>
        <MenuButton label="What the assistant may change" title="What the assistant may change" className="chip-btn" items={(['ask', 'propose', 'autonomous'] as const).map((mode) =>
          ({ id: mode, label: autonomyNames[mode], checked: assistant.autonomy === mode, run: () => assistant.setAutonomy(mode) }))}>
          {autonomyNames[assistant.autonomy]}<ChevronDown size={12}/></MenuButton>
        <button type="button" className="chip-btn" onClick={onOpenSettings} title="What the assistant may read and save" aria-label={`Read scope: ${scopeLabel}. Conversation settings`}>
          {scope.mode === 'selected' && <Lock size={11}/>}{scopeLabel}</button>
      </div>
      {assistant.busy ? <button type="button" className="send-btn stop" onClick={() => void assistant.cancelMessage()} aria-label="Stop" title="Stop"><Square size={12} fill="currentColor"/></button>
        : <button type="submit" className="send-btn" disabled={!assistant.message.trim()} aria-label="Send message" title="Send (↵)"><ArrowUp size={16}/></button>}
    </div>
    {assistant.provider === 'chatgpt' && <p className="composer-plan">Using ChatGPT plan · <button type="button" className="text-button"
      onClick={() => void window.serenity.openExternal(chatGPTUsageURL)}>Manage usage</button></p>}
  </form>
}

function Thinking({ provider, text }: { provider: Provider; text: string }) {
  const [phase, setPhase] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => setPhase((value) => (value + 1) % 3), 3200); return () => window.clearInterval(timer) }, [])
  if (text) return <article className="message assistant streaming" aria-busy="true">
    <small className="message-author">{providerLabels[provider]}</small><p className="message-text">{text}</p>
  </article>
  return <div className="ai-thinking" role="status" aria-label={`${providerLabels[provider]} is responding`}>
    <span className="thinking-mark" aria-hidden="true"><i/><i/><i/></span><span aria-hidden="true">{['Thinking…', 'Finding connections…', 'Putting it together…'][phase]}</span>
  </div>
}

/**
 * Changes the assistant suggested in this conversation, shown where they were asked for: pending ones can be accepted
 * or dismissed right here, and decided ones are summarized.
 */
export function ConversationSuggestions({ workspace, conversationId, ...actions }: ProposalActions & { workspace: WorkspaceSnapshot; conversationId: string | null }) {
  const [showDecided, setShowDecided] = useState(false)
  if (!conversationId) return null
  const suggestions = workspace.proposals.filter((item) => item.conversationId === conversationId)
  if (!suggestions.length) return null
  const pending = suggestions.filter((item) => item.status === 'pending')
  const decided = suggestions.length - pending.length
  return <section className="chat-suggestions" aria-label="Suggested changes">
    <h3>{pending.length ? `${pending.length} suggested ${pending.length === 1 ? 'change' : 'changes'} for you to review` : 'Suggestions from this chat'}</h3>
    {pending.map((item) => <ProposalCard key={item.id} item={item} workspace={workspace} {...actions}/>)}
    {decided > 0 && <button type="button" className="text-button" onClick={() => setShowDecided((value) => !value)} aria-expanded={showDecided}>
      {showDecided ? 'Hide' : 'Show'} {decided} decided {decided === 1 ? 'suggestion' : 'suggestions'}</button>}
    {showDecided && suggestions.filter((item) => item.status !== 'pending').map((item) => <ProposalCard key={item.id} item={item} workspace={workspace} {...actions}/>)}
  </section>
}

/** The messages of a conversation, or a short welcome for a new one. */
export function ConversationView({ assistant, intro, onOpenResource, suggestions }: { assistant: AssistantState; intro: ReactNode; onOpenResource(uri: string, side: boolean): void
  /** Changes suggested in this conversation, shown after its messages. */
  suggestions?: ReactNode }) {
  const end = useRef<HTMLDivElement>(null)
  const count = assistant.conversation?.messages.length ?? 0
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [count, assistant.busy, assistant.conversationId, assistant.streamingText])
  return <div className="messages">
    {!assistant.conversation && !assistant.busy && intro}
    {assistant.conversation?.messages.map((item) => <article key={item.id} className={`message ${item.role}`}>
      {item.role === 'assistant' && <small className="message-author" title={item.model ? `Model: ${item.model}` : undefined}>{providerName(item.provider)}</small>}
      {item.role === 'assistant' ? <AnswerText message={item} onOpenResource={onOpenResource}/> : <p className="message-text">{item.text}</p>}
      {item.sharedContext?.map((context, index) => <details className="context-inspector" key={index}>
        <summary>{context.records.length} of {context.availableCount} permitted records sent{item.sharedContext!.length > 1 ? ` · pass ${index + 1}` : ''}</summary>
        <p>{context.readScopeMode === 'selected'
          ? 'Only this conversation’s selected knowledge was available for this request.'
          : context.mode === 'retrieved'
            ? 'Relevant records were selected from the accessible workspace. Other records remain available for retrieval.'
            : 'All workspace records were supplied.'} {context.catalogShown < context.availableCount ? `${context.catalogShown} catalog entries shown.` : ''}</p>
        {context.records.map((record) => <div key={record.ref} className="context-record">
          <strong>{record.title}</strong>
          <small>{record.ref} · {record.sentCharacters}/{record.totalCharacters} characters · from {record.startCharacter} · SHA-256 {record.checksum.slice(0, 16)}…</small>
        </div>)}
      </details>)}
    </article>)}
    {!assistant.busy && suggestions}
    {assistant.busy && <Thinking provider={assistant.provider} text={assistant.streamingText}/>}
    <div ref={end}/>
  </div>
}

/** Read scope, save permissions, and retention for the current conversation. */
export function ConversationSettings({ workspace, assistant, onClose }: { workspace: WorkspaceSnapshot; assistant: AssistantState; onClose(): void }) {
  const scope = assistant.readScope
  const permissions = assistant.permissions
  return <Dialog title="Conversation settings" onClose={onClose} className="settings-small" footer={<>
    {assistant.conversationId ? <button className="primary" onClick={() => { void assistant.saveWorkflowSettings(); onClose() }}>Save</button>
      : <><small className="dialog-note">Saved with your first message.</small><button className="primary" onClick={onClose}>Done</button></>}
  </>}>
    <section className="form-section">
      <h3>What the assistant may read</h3>
      <div className="segmented" role="radiogroup" aria-label="AI read scope">
        {(['workspace', 'selected'] as const).map((mode) => <button key={mode} type="button" role="radio" aria-checked={scope.mode === mode}
          className={scope.mode === mode ? 'active' : ''} onClick={() => assistant.setReadScope({ ...scope, mode })}>{mode === 'workspace' ? 'Whole workspace' : 'Selected knowledge'}</button>)}
      </div>
      {scope.mode === 'selected' && <div className="read-scope-items">
        <label className="field-label">Entities</label>
        <ResourcePicker label="Allow an entity" placeholder="Find an entity to allow…" selected={scope.entityIds}
          options={workspace.entities.map((entity) => ({ id: entity.id, title: entity.title, detail: entity.type }))}
          onChange={(entityIds) => assistant.setReadScope({ ...scope, entityIds })} empty="No entities yet."/>
        <label className="field-label">Documents</label>
        <ResourcePicker label="Allow a document" placeholder="Find a document to allow…" selected={scope.documentNames}
          options={workspace.documents.map((document) => ({ id: document.name, title: document.name }))}
          onChange={(documentNames) => assistant.setReadScope({ ...scope, documentNames })} empty="No documents yet."/>
        <label className="check"><input type="checkbox" checked={scope.includeOtherConversations} onChange={(event) => assistant.setReadScope({ ...scope, includeOtherConversations: event.target.checked })}/>Other conversations</label>
        <label className="check"><input type="checkbox" checked={scope.includeCalendarAndTasks} onChange={(event) => assistant.setReadScope({ ...scope, includeCalendarAndTasks: event.target.checked })}/>Calendar and tasks</label>
      </div>}
      <p className="hint">This conversation’s own messages are always included. Background AI has separate settings.</p>
    </section>
    {assistant.autonomy === 'autonomous' && <section className="form-section">
      <h3>May save without asking</h3>
      {([['claims', 'Sourced claims'], ['entities', 'Entities in existing categories'], ['tasks', 'Tasks'], ['events', 'Calendar events']] as const).map(([key, label]) =>
        <label key={key} className="check"><input type="checkbox" checked={permissions[key]} onChange={(event) => assistant.setPermissions({ ...permissions, [key]: event.target.checked })}/>{label}</label>)}
      <p className="hint">New categories and ambiguous identities always go to Review.</p>
    </section>}
    <section className="form-section">
      <label className="check"><input type="checkbox" checked={assistant.retained} onChange={(event) => assistant.setRetained(event.target.checked)}/>Keep this conversation in the workspace</label>
    </section>
  </Dialog>
}

/** Conversations, newest first, for switching between them. */
export function ConversationList({ workspace, activeId, busy, onSelect, onStar, onDelete, compact = false }: {
  workspace: WorkspaceSnapshot
  activeId: string | null
  busy: boolean
  onSelect(conversation: Conversation): void
  onStar?(conversation: Conversation): void
  onDelete?(conversation: Conversation): void
  compact?: boolean
}) {
  const [query, setQuery] = useState('')
  const menu = useContextMenu()
  const wanted = query.trim().toLocaleLowerCase()
  const conversations = [...workspace.conversations].reverse().filter((item) => !wanted || item.title.toLocaleLowerCase().includes(wanted))
  const starred = conversations.filter((item) => item.starred)
  const recent = conversations.filter((item) => !item.starred)
  const rows = (items: Conversation[]) => items.map((item) => <div key={item.id} className={`conversation-row ${activeId === item.id ? 'active' : ''}`}
    onContextMenu={(event) => { event.preventDefault(); menu.open(event, item.title, [
      { id: 'star', label: item.starred ? 'Remove star' : 'Star chat', icon: <Star size={14}/>, run: () => onStar?.(item) },
      { id: 'delete', label: 'Delete chat', icon: <Trash2 size={14}/>, danger: true, run: () => onDelete?.(item) }
    ]) }}>
    <button type="button" className="conversation-select" disabled={busy} aria-current={activeId === item.id ? 'true' : undefined}
      onClick={() => onSelect(item)} title={item.title}><span>{item.title}</span>{!item.retained && <small>not kept</small>}</button>
    <button type="button" className={`conversation-star ${item.starred ? 'starred' : ''}`} disabled={busy}
      aria-label={`${item.starred ? 'Remove star from' : 'Star'} ${item.title}`} aria-pressed={Boolean(item.starred)} title={item.starred ? 'Remove star' : 'Star chat'}
      onClick={() => onStar?.(item)}><Star size={14} fill={item.starred ? 'currentColor' : 'none'}/></button>
  </div>)
  return <div className="conversation-list">
    {!compact && workspace.conversations.length > 6 && <label className="search-field"><Search size={14}/>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search conversations"/></label>}
    <nav aria-label="Conversations">
      {starred.length > 0 && <><h3 className="sidebar-heading">Starred</h3>{rows(starred)}</>}
      {!compact && <h3 className="sidebar-heading">Recents</h3>}
      {rows(recent)}
      {!workspace.conversations.length && <p className="sidebar-empty">Conversations you start show up here.</p>}
      {wanted && workspace.conversations.length > 0 && !conversations.length && <p className="sidebar-empty">No chats match.</p>}
    </nav>
    {menu.element}
  </div>
}

/** The conversation's actions: switch to another or delete this one. */
export function conversationMenu(workspace: WorkspaceSnapshot, assistant: AssistantState) {
  return [
    ...[...workspace.conversations].reverse().slice(0, 15).map((item) => ({ id: item.id, label: item.title, checked: item.id === assistant.conversationId,
      run: () => assistant.selectConversation(item) })),
    ...(workspace.conversations.length ? [] : [{ id: 'none', label: 'No earlier chats yet', disabled: true, run: () => undefined }]),
    ...(assistant.conversationId ? [{ id: 'delete', label: 'Delete this chat', icon: <Trash2 size={14}/>, danger: true, separated: true, run: () => void assistant.deleteConversation() }] : [])
  ]
}
