import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { Autonomy, Entity, Provider, ReadScope, SearchResult, WorkflowPermissions, WorkspaceSnapshot } from '../../shared/types'
import { modules, type ModuleId } from '../../shared/modules'
import { CalendarModule, TasksModule } from './module-views'
import { ConversationPanel } from './conversation-panel'
import { identityCandidates } from '../../shared/identity'
import { defaultReadScope, defaultWorkflowPermissions } from '../../shared/workflow'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './style.css'

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Entity | null>(null)
  const [dirty, setDirty] = useState(false)
  const [bodyMode, setBodyMode] = useState<'edit' | 'preview'>('edit')
  const [error, setError] = useState('')
  const [claim, setClaim] = useState({ key: '', value: '', source: 'Me' })
  const [claimTarget, setClaimTarget] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [view, setView] = useState<'knowledge' | 'conversation' | 'review' | 'documents' | 'activity' | 'settings' | 'calendar' | 'tasks'>('knowledge')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>('copilot')
  const [autonomy, setAutonomy] = useState<Autonomy>('propose')
  const [retained, setRetained] = useState(true)
  const [permissions, setPermissions] = useState<WorkflowPermissions>({ ...defaultWorkflowPermissions })
  const [readScope, setReadScope] = useState<ReadScope>({ ...defaultReadScope, entityIds: [], documentNames: [] })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [credentials, setCredentials] = useState<Record<Provider, boolean> | null>(null)
  const [keyProvider, setKeyProvider] = useState<Provider>('copilot')
  const [key, setKey] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await window.serenity.refresh()
      setWorkspace(next)
      setError('')
      if (!dirty && selected && next) {
        setDraft(next.entities.find((entity) => entity.id === selected) ?? null)
      }
    } catch (cause) {
      setError(String(cause))
    }
  }, [dirty, selected])

  useEffect(() => window.serenity.onWorkspaceChange(() => { void refresh() }), [refresh])
  useEffect(() => { void window.serenity.refresh().then(setWorkspace).catch((cause) => setError(String(cause))) }, [])
  useEffect(() => window.serenity.setEditorDirty(dirty), [dirty])
  useEffect(() => window.serenity.onIndexError((message) => setError(`Background AI: ${message}`)), [])

  async function chooseWorkspace() {
    try {
      const next = await window.serenity.chooseWorkspace()
      if (!next) return
      setWorkspace(next)
      setSelected(null)
      setDraft(null)
      setDirty(false)
      setBodyMode('edit')
      setError('')
      setView('knowledge')
      setConversationId(null)
      setPermissions({ ...defaultWorkflowPermissions })
      setReadScope({ ...defaultReadScope, entityIds: [], documentNames: [] })
      setResults(null)
    } catch (cause) {
      setError(String(cause))
    }
  }

  function selectEntity(entity: Entity) {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setSelected(entity.id)
    setDraft({ ...entity })
    setDirty(false)
    setBodyMode('preview')
    setError('')
    setView('knowledge')
  }

  function newEntity() {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setSelected(null)
    setDraft({ id: '', title: '', type: '', body: '' })
    setDirty(false)
    setBodyMode('edit')
    setError('')
    setView('knowledge')
  }

  async function saveEntity(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    try {
      const next = await window.serenity.saveEntity(draft)
      setWorkspace(next)
      const saved = draft.id ? next.entities.find((entity) => entity.id === draft.id) :
        next.entities.find((entity) => !workspace?.entities.some((existing) => existing.id === entity.id))
      setSelected(saved?.id ?? null)
      setDraft(saved ?? null)
      setDirty(false)
      setError('')
    } catch (cause) {
      setError(String(cause))
    }
  }

  async function addClaim(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    try {
      setWorkspace(await window.serenity.addClaim({ ...claim, value: claimTarget || claim.value, subject: selected }))
      setClaim({ key: '', value: '', source: 'Me' })
      setClaimTarget('')
      setError('')
    } catch (cause) {
      setError(String(cause))
    }
  }

  async function retractClaim(claimId: string) {
    const reason = window.prompt('Why is this claim no longer current? The original assertion will remain in history.')
    if (!reason?.trim()) return
    try { setWorkspace(await window.serenity.retractClaim(claimId, reason)); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  async function markCurrent(claimId: string) {
    const reason = window.prompt('Why should this be the current answer? Previous claims will remain visible.')
    if (!reason?.trim()) return
    try { setWorkspace(await window.serenity.setCurrentClaim(claimId, reason)); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  async function clearCurrent(key: string) {
    if (!selected || !window.confirm('Clear the current designation? Conflicting claims will again need clarification.')) return
    try { setWorkspace(await window.serenity.clearCurrentClaim(selected, key)); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) { setResults(null); return }
    try { setResults(await window.serenity.search(query)); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  async function searchSemantically() {
    if (!query.trim() || searching) return
    setSearching(true)
    try {
      const [lexical, semantic] = await Promise.all([
        window.serenity.search(query), window.serenity.semanticSearch(query, provider)
      ])
      setResults([...semantic, ...lexical.filter((entry) => !semantic.some((match) =>
        match.kind === entry.kind && match.id === entry.id && match.title === entry.title))])
      await refresh()
      setError('')
    } catch (cause) { setError(String(cause)) }
    finally { setSearching(false) }
  }

  async function searchSavedConcepts() {
    if (!query.trim()) return
    try {
      const [indexed, lexical] = await Promise.all([window.serenity.searchSemanticIndex(query), window.serenity.search(query)])
      setResults([...indexed, ...lexical.filter((entry) => !indexed.some((match) =>
        match.kind === entry.kind && match.id === entry.id && match.title === entry.title))])
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function importDocuments() {
    try {
      const next = await window.serenity.importDocuments()
      if (next) setWorkspace(next)
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!message.trim() || busy) return
    if (autonomy === 'ask' && !window.confirm(`Allow ${provider} to read this workspace for this request? No knowledge changes will be saved without separate approval.`)) return
    setBusy(true)
    try {
      const next = await window.serenity.sendMessage({ conversationId: conversationId ?? undefined, text: message, provider, autonomy, retained, permissions, readScope })
      if (!conversationId) {
        const created = next.conversations.find((item) => !workspace?.conversations.some((old) => old.id === item.id))
        setConversationId(created?.id ?? null)
      }
      setWorkspace(next)
      setMessage('')
      setError('')
    } catch (cause) {
      await refresh()
      setError(String(cause))
    } finally { setBusy(false) }
  }

  async function cancelMessage() {
    try { await window.serenity.cancelMessage() }
    catch (cause) { setError(String(cause)) }
  }

  async function resolveProposal(id: string, accept: boolean) {
    try { setWorkspace(await window.serenity.resolveProposal(id, accept)); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  async function deleteConversation() {
    if (!conversationId || !window.confirm('Delete this conversation? Confirmed knowledge remains in your workspace.')) return
    try {
      setWorkspace(await window.serenity.deleteConversation(conversationId))
      setConversationId(null)
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function saveWorkflowSettings() {
    if (!conversationId) return
    try {
      setWorkspace(await window.serenity.updateConversationSettings(conversationId, { autonomy, permissions, retained, readScope }))
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function openSettings() {
    setView('settings')
    try { setCredentials(await window.serenity.credentialStatus()); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    try {
      setCredentials(await window.serenity.saveCredential(keyProvider, key))
      setKey('')
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function toggleModule(id: ModuleId, enabled: boolean) {
    try {
      const next = await window.serenity.setModule(id, enabled)
      setWorkspace(next)
      if (!enabled && view === id) setView('knowledge')
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function changeSemanticProvider(selected: Provider) {
    try { setWorkspace(await window.serenity.setSemanticProvider(selected)); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  async function mergeSelected() {
    if (!selected || !mergeTarget || !workspace) return
    if (dirty) { setError('Save or discard your edits before merging.'); return }
    const target = workspace.entities.find((entity) => entity.id === mergeTarget)
    if (!window.confirm(`Archive ${draft?.title} and link its claims to ${target?.title}? The archived file and merge record remain in the workspace.`)) return
    try {
      const next = await window.serenity.mergeEntities(selected, mergeTarget)
      setWorkspace(next)
      setSelected(mergeTarget)
      setDraft(next.entities.find((entity) => entity.id === mergeTarget) ?? null)
      setMergeTarget('')
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function undoMerge(source: string) {
    const reason = window.prompt('Why are you restoring this archived entity? The merge history will remain visible.')
    if (!reason?.trim()) return
    try { setWorkspace(await window.serenity.unmergeEntities(source, reason)); setError('') }
    catch (cause) { setError(String(cause)) }
  }

  const claims = workspace?.claims.filter((item) => item.subject === selected) ?? []
  const incoming = workspace?.claims.filter((item) => item.value === selected && item.subject !== selected && item.status === 'confirmed') ?? []
  const activeClaims = claims.filter((item) => item.status !== 'retracted')
  const conflicts = [...new Set(activeClaims.map((item) => item.key))].filter((key) => new Set(activeClaims.filter((item) => item.key === key).map((item) => item.value)).size > 1 && !activeClaims.some((item) => item.key === key && item.isCurrent))
  const resolvedKeys = [...new Set(activeClaims.filter((item) => item.isCurrent).map((item) => item.key))]
  const conversation = workspace?.conversations.find((item) => item.id === conversationId)
  const pending = workspace?.proposals.filter((proposal) => proposal.status === 'pending') ?? []
  const candidates = draft && !draft.id && workspace ? identityCandidates(draft.title, draft.type, workspace.entities).slice(0, 4) : []
  const activity = [...(workspace?.claims.map((item) => ({ id: item.id, at: item.recordedAt, title: `Claim: ${item.key}`, detail: `${workspace.entities.find((entity) => entity.id === item.subject)?.title ?? 'Unknown entity'} · ${item.value} · ${item.source}` })) ?? []),
    ...(workspace?.mergeHistory.flatMap((item) => [
      { id: `${item.id}:${item.recordedAt}:merge`, at: item.recordedAt, title: `Merged ${item.title}`, detail: `Archived; linked to ${workspace.entities.find((entity) => entity.id === item.target)?.title ?? item.target}` },
      ...(item.undoneAt ? [{ id: `${item.id}:${item.recordedAt}:undo`, at: item.undoneAt, title: `Restored ${item.title}`, detail: item.undoReason ?? 'Merge reversed' }] : [])
    ]) ?? []),
    ...(workspace?.resolutions.map((item) => ({ id: item.id, at: item.recordedAt, title: item.currentClaimId ? `Current ${item.key} selected` : `Current ${item.key} cleared`, detail: item.reason })) ?? []),
    ...(workspace?.modules.calendar ? workspace.events.map((item) => ({ id: item.id, at: item.start, title: `Event: ${item.title}`, detail: `${item.notes}${item.source ? ` · Source: ${item.source}` : ''}` })) : []),
    ...(workspace?.modules.tasks ? workspace.tasks.map((item) => ({ id: item.id, at: item.recordedAt ?? item.due ?? '', title: `Task: ${item.title}`, detail: `${item.completed ? 'Completed' : 'Open'}${item.source ? ` · Source: ${item.source}` : ''}` })) : []),
    ...(workspace?.proposals.map((item) => ({ id: item.id, at: item.recordedAt, title: `Proposal ${item.status}`, detail: `${item.kind === 'claim' ? `${item.key}: ${item.value}` : item.title} · ${item.provider}` })) ?? []),
    ...(workspace?.conversations.flatMap((item) => item.messages.map((message) => ({ id: message.id, at: message.recordedAt, title: message.role === 'user' ? 'You' : `${message.provider} replied`, detail: message.text.slice(0, 180) }))) ?? [])]
    .sort((a, b) => b.at.localeCompare(a.at))

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✳</span><div><strong>serenity</strong><small>your knowledge, connected</small></div></div>
      <div className="workspace-control">
        <span className="eyebrow">WORKSPACE</span>
        <button className="workspace-button" onClick={() => void chooseWorkspace()} title={workspace?.path ?? 'Choose a workspace'}>
          <span className="workspace-name">{workspace ? workspace.path.split(/[\\/]/).filter(Boolean).at(-1) : 'Choose a folder'}</span><span>↗</span>
        </button>
        {workspace && <small className="path" title={workspace.path}>{workspace.path}</small>}
        {workspace && <button className="open-workspace" onClick={() => void window.serenity.openWorkspaceFolder().catch((cause) => setError(String(cause)))}>Open workspace folder ↗</button>}
      </div>
      {workspace && <>
        <div className="navigation">
          <button className={view === 'knowledge' ? 'active' : ''} onClick={() => setView('knowledge')}>◇ <span>Knowledge</span></button>
          <button className={view === 'conversation' ? 'active' : ''} onClick={() => setView('conversation')}>✳ <span>Conversations</span></button>
          <button className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>◉ <span>Review {pending.length ? `(${pending.length})` : ''}</span></button>
          <button className={view === 'documents' ? 'active' : ''} onClick={() => setView('documents')}>▤ <span>Documents</span></button>
          {workspace.modules.calendar && <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>▦ <span>Calendar</span></button>}
          {workspace.modules.tasks && <button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}>☑ <span>Tasks</span></button>}
          <button className={view === 'activity' ? 'active' : ''} onClick={() => { setView('activity'); void refresh() }}>◷ <span>Activity</span></button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => void openSettings()}>⚙ <span>Connections</span></button>
        </div>
        {view === 'knowledge' && <>
        <form className="sidebar-search" onSubmit={(event) => void search(event)}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspace..." aria-label="Search workspace"/><button type="submit" aria-label="Search">⌕</button></form>
        <button className="semantic-button" disabled={!query.trim() || searching} onClick={() => void searchSemantically()}>{searching ? 'Searching with AI…' : `Search meaning with ${provider} ✳`}</button>
        {workspace.modules.semanticIndex && <button className="semantic-button" disabled={!query.trim()} onClick={() => void searchSavedConcepts()}>Search saved concepts · offline</button>}
        {results && <div className="search-results"><span className="eyebrow">RESULTS · {results.length}</span>{results.map((result, index) => <button key={`${result.kind}-${result.id}-${index}`} onClick={() => {
          const entity = workspace.entities.find((item) => item.id === result.id)
          if (entity) selectEntity(entity)
          else if (result.kind === 'document') setView('documents')
          else if (result.kind === 'task' && workspace.modules.tasks) setView('tasks')
          else if (result.kind === 'event' && workspace.modules.calendar) setView('calendar')
        }}><strong>{result.title}</strong><small>{result.detail}</small></button>)}<button className="clear-results" onClick={() => setResults(null)}>Clear results</button></div>}
        <div className="list-heading"><span className="eyebrow">KNOWLEDGE <span className="count">{workspace.entities.length}</span></span><button className="icon-button" onClick={newEntity} title="New entity" aria-label="New entity">+</button></div>
        <nav className="entity-list" aria-label="Entities">
          {workspace.entities.map((entity) => <button key={entity.id} className={`entity-link ${selected === entity.id ? 'active' : ''}`} onClick={() => selectEntity(entity)}><span className="entity-icon">◇</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span></button>)}
          {workspace.entities.length === 0 && <p className="hint">Your workspace is ready. Create an entity to begin.</p>}
        </nav>
        </>}
        {view === 'conversation' && <nav className="entity-list" aria-label="Conversations"><button className="entity-link" onClick={() => { setConversationId(null); setRetained(true); setAutonomy('propose'); setPermissions({ ...defaultWorkflowPermissions }); setReadScope({ ...defaultReadScope, entityIds: [], documentNames: [] }) }}>+ New conversation</button>{workspace.conversations.map((item) => <button key={item.id} className={`entity-link ${conversationId === item.id ? 'active' : ''}`} onClick={() => { setConversationId(item.id); setRetained(item.retained); setAutonomy(item.autonomy ?? 'propose'); setPermissions(item.permissions ?? { ...defaultWorkflowPermissions }); setReadScope(item.readScope ?? { ...defaultReadScope, entityIds: [], documentNames: [] }) }}><span><strong>{item.title}</strong><small>{item.messages.length} messages {item.retained ? '' : '· not retained'}</small></span></button>)}</nav>}
        {view === 'conversation' && autonomy === 'autonomous' && <div className="workflow-scope"><span className="eyebrow">THIS WORKFLOW MAY AUTO-SAVE</span>{([
          ['claims', 'Sourced claims'], ['entities', 'Existing-category entities'], ['tasks', 'Tasks'], ['events', 'Calendar events']
        ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions[key]} onChange={(event) => setPermissions({ ...permissions, [key]: event.target.checked })}/>{label}</label>)}<small>New categories and ambiguous identities still need your review.</small></div>}
        {view === 'conversation' && <div className="read-scope"><span className="eyebrow">WHAT AI MAY READ</span><select aria-label="AI read scope" value={readScope.mode} onChange={(event) => setReadScope({ ...readScope, mode: event.target.value as ReadScope['mode'] })}><option value="workspace">Entire workspace</option><option value="selected">Selected knowledge</option></select>{readScope.mode === 'selected' && <div className="read-scope-items"><strong>Entities</strong>{workspace.entities.map((entity) => <label key={entity.id}><input type="checkbox" checked={readScope.entityIds.includes(entity.id)} onChange={(event) => setReadScope({ ...readScope, entityIds: event.target.checked ? [...readScope.entityIds, entity.id] : readScope.entityIds.filter((id) => id !== entity.id) })}/>{entity.title}</label>)}<strong>Documents</strong>{workspace.documents.map((document) => <label key={document.name}><input type="checkbox" checked={readScope.documentNames.includes(document.name)} onChange={(event) => setReadScope({ ...readScope, documentNames: event.target.checked ? [...readScope.documentNames, document.name] : readScope.documentNames.filter((name) => name !== document.name) })}/>{document.name}</label>)}<label><input type="checkbox" checked={readScope.includeOtherConversations} onChange={(event) => setReadScope({ ...readScope, includeOtherConversations: event.target.checked })}/>Other conversations</label><label><input type="checkbox" checked={readScope.includeCalendarAndTasks} onChange={(event) => setReadScope({ ...readScope, includeCalendarAndTasks: event.target.checked })}/>Calendar and tasks</label></div>}<small>Current conversation messages are included. Background AI modules have separate workspace settings.</small></div>}
        {view === 'conversation' && conversationId && <button className="workflow-save" onClick={() => void saveWorkflowSettings()}>Save workflow settings</button>}
      </>}
      <div className="sidebar-footer">On-device workspace · AI connections coming next</div>
    </aside>
    <main className="main">
      <header className="topbar"><span>{workspace ? 'Knowledge workspace' : 'Welcome to Serenity'}</span>{workspace && <button className="text-button" onClick={() => void refresh()}>Refresh files ↻</button>}</header>
      {error && <div className="notice error" role="alert">{error}</div>}
      {workspace?.errors.map((item) => <div key={item} className="notice warning" role="alert">Could not read {item}</div>)}
      {view === 'conversation' && readScope.mode === 'selected' && <div className="notice warning" role="status">Selected read scope: AI only receives chosen knowledge and this conversation. The accessible records are shown with each response.</div>}
      {view === 'review' && workspace?.proposals.some((item) => item.status === 'pending' && item.reviewReason) && <div className="notice warning" role="status">Some proposals involve similar entities. Verify the identity before accepting them.</div>}
      {!workspace ? <section className="welcome"><div className="welcome-symbol">✳</div><span className="eyebrow">A PLACE TO CONNECT WHAT MATTERS</span><h1>Your world,<br/><em>within reach.</em></h1><p>Choose a folder on your device for Serenity's knowledge files. You can read and edit them with any text editor.</p><button className="primary" onClick={() => void chooseWorkspace()}>Choose a workspace <span>↗</span></button></section>
        : view === 'calendar' && workspace.modules.calendar ? <CalendarModule workspace={workspace} onUpdate={setWorkspace} onError={setError} />
        : view === 'tasks' && workspace.modules.tasks ? <TasksModule workspace={workspace} onUpdate={setWorkspace} onError={setError} />
        : view === 'conversation' ? <ConversationPanel conversation={conversation} provider={provider} onProviderChange={setProvider} autonomy={autonomy} onAutonomyChange={setAutonomy} retained={retained} onRetentionChange={setRetained} message={message} onMessageChange={setMessage} busy={busy} onSend={(event) => void sendMessage(event)} onCancel={() => void cancelMessage()} onDelete={() => void deleteConversation()} />
        : view === 'review' ? <section className="page"><span className="eyebrow">KNOWLEDGE REVIEW</span><h1>Proposals & activity</h1><p>Decide which suggested knowledge belongs in your workspace. Previous decisions remain visible.</p>{workspace.proposals.length === 0 && <p className="hint">Nothing to review yet. Conversations can suggest claims, entities, tasks, and events.</p>}{workspace.proposals.map((item) => <article key={item.id} className="review-card"><span className="eyebrow">{item.status} · {item.kind} · {item.provider} · {item.origin}</span><h2>{item.kind === 'claim' ? `${workspace.entities.find((entity) => entity.id === item.subject)?.title ?? 'Unknown entity'} · ${item.key}` : item.title}</h2><strong>{item.kind === 'claim' ? item.value : item.kind === 'entity' ? `Suggested category: ${item.type}` : item.kind === 'task' ? `Due ${item.due ?? 'not set'}` : `Starts ${item.start}`}</strong><p>Source: {item.source}{item.kind === 'claim' && item.confidence !== undefined ? ` · AI-estimated confidence: ${Math.round(item.confidence * 100)}%` : ''}</p>{item.kind === 'entity' && identityCandidates(item.title, item.type, workspace.entities).length > 0 && <p className="review-warning">Potentially the same as {identityCandidates(item.title, item.type, workspace.entities).map(({ entity }) => entity.title).join(', ')}. Review the identity before accepting.</p>}{item.status === 'pending' && <div className="review-actions"><button className="primary" onClick={() => void resolveProposal(item.id, true)}>Accept</button><button className="secondary" onClick={() => void resolveProposal(item.id, false)}>Dismiss</button></div>}</article>)}</section>
        : view === 'documents' ? <section className="page"><span className="eyebrow">SOURCES</span><h1>Documents</h1><p>Imported documents are copied into the workspace. Text, PDF, and DOCX contents can be searched and included in AI conversations.</p><button className="primary" onClick={() => void importDocuments()}>Import documents +</button><div className="document-list">{workspace.documents.map((item) => <div key={item.name} className="document-row"><span>▤</span><strong>{item.name}</strong><small>{Math.round(item.size / 1024)} KB</small><button className="text-button" onClick={() => { setConversationId(null); setMessage(`Analyze the imported document ${item.name}. Summarize it, identify useful knowledge about existing entities, and suggest claims with precise sources. Ask me to clarify any ambiguous identities.`); setView('conversation') }}>Analyze ↗</button></div>)}</div></section>
        : view === 'activity' ? <section className="page"><span className="eyebrow">WORKSPACE HISTORY</span><h1>Activity</h1><p>Follow knowledge changes and inspect which records provider requests used. Prompt contents are not duplicated in the activity log.</p>{workspace.providerActivity.length > 0 && <div className="provider-activity"><h2>AI provider requests</h2>{[...workspace.providerActivity].reverse().map((entry) => <details key={entry.id}><summary><strong>{entry.provider} · {entry.operation} · {entry.status}</strong><small>{new Date(entry.startedAt).toLocaleString()} · {entry.promptCharacters} characters sent</small></summary><p>Prompt SHA-256: {entry.promptChecksum}</p>{entry.error && <p>Error: {entry.error}</p>}<p>Referenced workspace records ({entry.refs.length}):</p>{entry.refs.map((ref) => <small key={ref}>{ref}</small>)}</details>)}</div>}{activity.length === 0 && <p className="hint">Your workspace history will appear here.</p>}{activity.map((item) => <article key={item.id} className="activity-row"><time>{item.at ? new Date(item.at).toLocaleString() : 'Date unknown'}</time><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</section>
        : view === 'settings' ? <section className="page"><span className="eyebrow">WORKSPACE SETTINGS</span><h1>Modules & connections</h1><p>Turn modules off without removing their files. Calendar and tasks belong to Serenity and connect to the same knowledge workspace. Background AI modules are off by default.</p><div className="document-list">{modules.map((item) => <label key={item.id} className="module-toggle"><span><strong>{item.title}</strong><small>{item.description}</small></span><input type="checkbox" checked={workspace.modules[item.id]} onChange={(event) => void toggleModule(item.id, event.target.checked)}/></label>)}</div><div className="semantic-settings"><label htmlFor="index-provider">Background AI provider (index & document analysis)</label><select id="index-provider" value={workspace.semanticProvider} onChange={(event) => void changeSemanticProvider(event.target.value as Provider)}><option value="copilot">GitHub Copilot</option><option value="codex">OpenAI Codex</option><option value="claude">Claude</option></select><small>{workspace.semanticIndex ? `Last indexed ${workspace.semanticIndex.count} records on ${new Date(workspace.semanticIndex.generatedAt).toLocaleString()}` : 'No background index yet. Enabling background AI may send workspace content to this provider.'}</small></div><h2>AI providers</h2><p>Use an existing provider sign-in where supported, or set an API key. Claude requires an Anthropic API key for third-party apps. Saved keys stay outside the knowledge workspace and are protected by your operating system.</p><div className="document-list">{(['copilot', 'codex', 'claude'] as const).map((name) => <div key={name} className="document-row"><span>✳</span><strong>{name === 'copilot' ? 'GitHub Copilot' : name === 'codex' ? 'OpenAI Codex' : 'Claude Agent SDK'}</strong><small>{credentials?.[name] ? 'Key saved' : name === 'claude' ? 'API key required' : 'Use provider sign-in or add a key'}</small></div>)}</div><form className="connection-form" onSubmit={(event) => void saveKey(event)}><h2>Set an API key or token</h2><label htmlFor="key-provider">Provider</label><select id="key-provider" value={keyProvider} onChange={(event) => setKeyProvider(event.target.value as Provider)}><option value="copilot">GitHub token</option><option value="codex">Codex API key</option><option value="claude">Anthropic API key</option></select><label htmlFor="provider-key">Credential</label><input id="provider-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste a key or token"/><div className="review-actions"><button className="primary" type="submit" disabled={!key.trim()}>Save securely</button>{credentials?.[keyProvider] && <button className="secondary" type="button" onClick={() => void window.serenity.saveCredential(keyProvider, '').then(setCredentials).catch((cause) => setError(String(cause)))}>Remove saved key</button>}</div></form></section>
        : !draft ? <section className="empty"><span className="empty-symbol">◇</span><h1>Start with what you know.</h1><p>Create a person, project, idea, place, or anything else meaningful to you. Categories are yours to define.</p><button className="primary" onClick={newEntity}>Create an entity <span>+</span></button></section>
          : <div className="content">
              <section className="editor">
                <span className="eyebrow">{draft.id ? 'ENTITY' : 'NEW ENTITY'}</span>
                <form onSubmit={(event) => void saveEntity(event)}>
                  <label className="field-label" htmlFor="title">Name</label>
                  <input id="title" className="title-input" placeholder="What is it called?" value={draft.title} required onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setDirty(true) }} />
                  <label className="field-label" htmlFor="type">Type · your own words</label>
                  <input id="type" placeholder="Person, project, concept..." value={draft.type} required onChange={(event) => { setDraft({ ...draft, type: event.target.value }); setDirty(true) }} />
                  {candidates.length > 0 && <div className="candidate-box"><strong>Could this already exist?</strong><p>Review these matches before creating a new entity. Similar names do not prove they are the same.</p>{candidates.map(({ entity }) => <button type="button" key={entity.id} onClick={() => selectEntity(entity)}>{entity.title} · {entity.type} ↗</button>)}</div>}
                  <label className="field-label" htmlFor="body">Context · Markdown</label>
                  <div className="body-tabs"><button type="button" className={bodyMode === 'preview' ? 'active' : ''} onClick={() => setBodyMode('preview')}>Read</button><button type="button" className={bodyMode === 'edit' ? 'active' : ''} onClick={() => setBodyMode('edit')}>Edit Markdown</button></div>
                  {bodyMode === 'edit' ? <textarea id="body" placeholder="Tell the story in your own words..." value={draft.body} onChange={(event) => { setDraft({ ...draft, body: event.target.value }); setDirty(true) }} /> :
                    <div className="markdown-preview">{draft.body.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      a: ({ children, href }) => <span className="preview-link" title={href}>{children}</span>,
                      img: ({ alt }) => <span className="preview-image">[Image: {alt || 'no description'}]</span>
                    }}>{draft.body}</ReactMarkdown> : <p className="hint">Nothing written yet. Switch to Edit Markdown to add context.</p>}</div>}
                  <div className="form-actions"><span>{dirty ? 'Unsaved changes' : draft.id ? 'Saved to your workspace' : 'Ready to create'}</span><button className="primary" type="submit">{draft.id ? 'Save changes' : 'Create entity'}</button></div>
                </form>
              </section>
              <aside className="details"><span className="eyebrow">CLAIMS & SOURCES</span><h2>What we know</h2><p className="detail-intro">Individual facts stay connected to their source. Conflicting claims remain visible.</p>
                {resolvedKeys.map((key) => { const choice = activeClaims.find((item) => item.key === key && item.isCurrent)!; const decision = [...workspace.resolutions].reverse().find((item) => item.subject === selected && item.key === key && item.currentClaimId === choice.id); return <div className="current-banner" key={key}><strong>Current {key}: {workspace.entities.find((entity) => entity.id === choice.value)?.title ?? choice.value}</strong><small>{decision?.reason ?? 'Selected by the user'} · earlier claims remain below.</small><button onClick={() => void clearCurrent(key)}>Undo designation</button></div> })}
                {conflicts.map((key) => { const possible = activeClaims.filter((item) => item.key === key); const humanClaims = possible.filter((item) => item.origin === 'human'); const likely = humanClaims.length === 1 ? humanClaims[0] : null; return <div className="conflict" key={key}><strong>Conflicting {key}</strong><small>{likely ? `A direct statement suggests ${workspace.entities.find((entity) => entity.id === likely.value)?.title ?? likely.value}. This is not resolved.` : 'No clear answer from the available sources. Please clarify.'}</small><button onClick={() => { setConversationId(null); setMessage(`I have conflicting information about ${draft.title}'s ${key}. What do the sources say, and what should I clarify?`); setView('conversation') }}>Discuss this ↗</button></div> })}
                {claims.map((item) => { const target = workspace.entities.find((entity) => entity.id === item.value); const sourceEntity = workspace.merges.find((merge) => merge.id === item.mergedFrom); return <div className={`claim ${item.status === 'retracted' ? 'retracted' : ''}`} key={item.id}><span className="eyebrow">{item.key} {item.isCurrent ? '· CURRENT' : conflicts.includes(item.key) ? '· CONFLICT' : resolvedKeys.includes(item.key) ? '· PREVIOUS ALTERNATIVE' : ''}</span>{target ? <button className="claim-link" onClick={() => selectEntity(target)}>{target.title} ↗</button> : <strong>{item.value}</strong>}<small>From {item.source} · {item.origin === 'human' ? 'direct statement' : item.origin === 'ai-inference' ? 'AI inference' : 'AI extraction'} · {item.status}{item.confidence !== undefined ? ` · AI estimate ${Math.round(item.confidence * 100)}%` : ''}{sourceEntity ? ` · archived from ${sourceEntity.title}` : ''}{item.retractionReason ? ` · ${item.retractionReason}` : ''}</small>{item.status === 'confirmed' && <div className="claim-actions"><button onClick={() => void markCurrent(item.id)}>{item.isCurrent ? 'Change reason / reaffirm' : 'Mark current'}</button><button onClick={() => void retractClaim(item.id)}>Retract</button></div>}</div> })}
                {claims.length === 0 && <p className="hint">No claims recorded yet.</p>}
                {incoming.length > 0 && <div className="incoming"><h3>Connected from elsewhere</h3>{incoming.map((link) => { const source = workspace.entities.find((entity) => entity.id === link.subject); return source && <button key={link.id} onClick={() => selectEntity(source)}>{source.title} · {link.key} ↗</button> })}</div>}
                {selected && <form className="claim-form" onSubmit={(event) => void addClaim(event)}><h3>Add a claim</h3><label htmlFor="claim-key">About or relationship</label><input id="claim-key" placeholder="e.g. birthday, friend of" required value={claim.key} onChange={(event) => setClaim({ ...claim, key: event.target.value })}/><label htmlFor="claim-value">Value</label><input id="claim-value" placeholder="e.g. September 7" required={!claimTarget} value={claim.value} onChange={(event) => setClaim({ ...claim, value: event.target.value })} disabled={Boolean(claimTarget)}/><label htmlFor="claim-target">Or link another entity</label><select id="claim-target" value={claimTarget} onChange={(event) => setClaimTarget(event.target.value)}><option value="">No entity linked</option>{workspace.entities.filter((entity) => entity.id !== selected).map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><label htmlFor="claim-source">Source</label><input id="claim-source" required value={claim.source} onChange={(event) => setClaim({ ...claim, source: event.target.value })}/><button type="submit" className="secondary">Add claim +</button></form>}
                {selected && workspace.entities.length > 1 && <div className="merge-form"><h3>Same as another entity?</h3><p>Archive this entity and resolve its links to the selected entity. Its original file and history remain available.</p><select aria-label="Merge into" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Choose the surviving entity</option>{workspace.entities.filter((entity) => entity.id !== selected).map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><button className="secondary" disabled={!mergeTarget} onClick={() => void mergeSelected()}>Merge into selected entity</button></div>}
                {selected && workspace.merges.filter((item) => item.target === selected).map((item) => <div className="merge-form" key={item.id}><h3>Archived as {draft.title}</h3><p>{item.title} was merged here. Its original file and links can be restored without deleting the merge history.</p><button className="secondary" onClick={() => void undoMerge(item.id)}>Restore {item.title}</button></div>)}
              </aside>
            </div>}
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
