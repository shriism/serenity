import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, FolderOpen, Link2, Plus, RotateCw, Search } from 'lucide-react'
import type { Autonomy, Conversation, Entity, Provider, ReadScope, SearchResult, WorkflowPermissions, WorkspaceSnapshot } from '../../shared/types'
import { CalendarModule, TasksModule } from './module-views'
import { ConversationPanel } from './conversation-panel'
import { ConversationList } from './conversation-list'
import { ReviewPanel } from './review-panel'
import { ClaimCard } from './claim-card'
import { DocumentsPanel } from './documents-panel'
import { ActivityPanel } from './activity-panel'
import { SettingsPanel } from './settings-panel'
import { identityCandidates } from '../../shared/identity'
import { defaultReadScope, defaultWorkflowPermissions } from '../../shared/workflow'
import { AppNavigation } from './navigation'
import { HomePanel } from './home-panel'
import { CommandPalette } from './command-palette'
import { ThemeControl, useTheme } from './theme'
import type { View } from './views'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './style.css'

const serenityIcon = new URL('../../../assets/icon.svg', import.meta.url).href

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
  const [view, setView] = useState<View>('home')
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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [focusVersion, setFocusVersion] = useState(0)
  const [theme, setTheme] = useTheme()
  const searchSequence = useRef(0)

  const closePalette = useCallback(() => {
    searchSequence.current++
    setPaletteOpen(false)
    setQuery('')
    setResults(null)
  }, [])

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
  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (paletteOpen) closePalette()
        else setPaletteOpen(true)
      } else if (event.key === 'Escape') closePalette()
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [closePalette, paletteOpen])

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
      setView('home')
      setConversationId(null)
      setPermissions({ ...defaultWorkflowPermissions })
      setReadScope({ ...defaultReadScope, entityIds: [], documentNames: [] })
      closePalette()
      setFocusedEventId(null)
      setFocusedTaskId(null)
    } catch (cause) {
      setError(String(cause))
    }
  }

  function selectEntity(entity: Entity): boolean {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return false
    setSelected(entity.id)
    setDraft({ ...entity })
    setDirty(false)
    setBodyMode('preview')
    setError('')
    setView('knowledge')
    return true
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

  function startConversation(prompt = '') {
    if (message.trim() && !window.confirm('Discard your unsent message?')) return
    setConversationId(null)
    setAutonomy('propose')
    setPermissions({ ...defaultWorkflowPermissions })
    setReadScope({ ...defaultReadScope, entityIds: [], documentNames: [] })
    setRetained(true)
    setMessage(prompt)
    setView('conversation')
  }

  function selectConversation(item: Conversation) {
    if (busy || (message.trim() && item.id !== conversationId && !window.confirm('Discard your unsent message?'))) return
    setConversationId(item.id)
    setRetained(item.retained)
    setAutonomy(item.autonomy ?? 'propose')
    setPermissions(item.permissions ?? { ...defaultWorkflowPermissions })
    setReadScope(item.readScope ?? { ...defaultReadScope, entityIds: [], documentNames: [] })
    setMessage('')
    setView('conversation')
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

  async function searchText(value: string) {
    setQuery(value)
    const request = ++searchSequence.current
    if (!value.trim()) { setResults(null); return }
    try {
      const matches = await window.serenity.search(value)
      if (request === searchSequence.current) setResults(matches)
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  function openSearchResult(result: SearchResult) {
    const entity = workspace?.entities.find((item) => item.id === result.id ||
      (result.kind === 'claim' && item.id === workspace.claims.find((claim) => claim.id === result.id)?.subject))
    if (entity) {
      if (selectEntity(entity)) closePalette()
      return
    }
    if (result.kind === 'document') setView('documents')
    if (result.kind === 'task' && workspace?.modules.tasks) openTask(result.id)
    if (result.kind === 'event' && workspace?.modules.calendar) openEvent(result.id)
    closePalette()
  }

  function openEvent(id: string) {
    setFocusedEventId(id)
    setFocusVersion((version) => version + 1)
    setView('calendar')
  }

  function openTask(id: string) {
    setFocusedTaskId(id)
    setFocusVersion((version) => version + 1)
    setView('tasks')
  }

  function navigate(destination: View) {
    if (destination === 'calendar') setFocusedEventId(null)
    if (destination === 'tasks') setFocusedTaskId(null)
    setView(destination)
    if (destination === 'activity') void refresh()
  }

  async function searchSemantically() {
    if (!query.trim() || searching) return
    setSearching(true)
    const request = ++searchSequence.current
    try {
      const [lexical, semantic] = await Promise.all([
        window.serenity.search(query), window.serenity.semanticSearch(query, provider)
      ])
      if (request === searchSequence.current) setResults([...semantic, ...lexical.filter((entry) => !semantic.some((match) =>
        match.kind === entry.kind && match.id === entry.id && match.title === entry.title))])
      await refresh()
      setError('')
    } catch (cause) { setError(String(cause)) }
    finally { setSearching(false) }
  }

  async function searchSavedConcepts() {
    if (!query.trim()) return
    const request = ++searchSequence.current
    try {
      const [indexed, lexical] = await Promise.all([window.serenity.searchSemanticIndex(query), window.serenity.search(query)])
      if (request === searchSequence.current) setResults([...indexed, ...lexical.filter((entry) => !indexed.some((match) =>
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

  async function openDocument(name: string) {
    try { await window.serenity.openDocument(name); setError('') }
    catch (cause) { setError(String(cause)) }
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

  async function attachProposal(id: string, entityId: string) {
    try { setWorkspace(await window.serenity.attachEntityProposal(id, entityId)); setError('') }
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
  const title: Record<View, string> = { home: 'Home', knowledge: 'Knowledge', conversation: 'Conversations', review: 'Review', documents: 'Documents', calendar: 'Calendar', tasks: 'Tasks', activity: 'Activity', settings: 'Settings' }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><img className="brand-icon" src={serenityIcon} alt=""/><div><strong>Serenity</strong><small>PERSONAL KNOWLEDGE</small></div></div>
      <div className="workspace-control">
        <button className="workspace-button" onClick={() => void chooseWorkspace()} title={workspace?.path ?? 'Choose a workspace'}>
          <span className="workspace-avatar">{workspace ? workspace.path.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 1).toUpperCase() : '+'}</span>
          <span className="workspace-info"><strong>{workspace ? workspace.path.split(/[\\/]/).filter(Boolean).at(-1) : 'Choose a folder'}</strong><small>{workspace ? 'Local workspace' : 'Start here'}</small></span>
          <span className="workspace-chevron">⌄</span>
        </button>
        {workspace && <small className="workspace-path" title={workspace.path}>{workspace.path}</small>}
      </div>
      {workspace && <div className="sidebar-scroller">
        <AppNavigation workspace={workspace} view={view} pendingCount={pending.length} onNavigate={navigate}/>
      </div>}
      <div className="sidebar-footer">
        {workspace && <button className="footer-folder" onClick={() => void window.serenity.openWorkspaceFolder().catch((cause) => setError(String(cause)))}><FolderOpen size={16}/> Open workspace folder</button>}
        <ThemeControl preference={theme} onChange={setTheme}/>
        <div className="local-status"><span/> On this device</div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>{workspace ? title[view] : 'Welcome'}</strong></div>
        {workspace && <div className="topbar-actions">
          <button className="topbar-search" onClick={() => setPaletteOpen(true)}><Search size={16}/><span>Search anything</span><kbd>{navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd></button>
          <button className="topbar-icon" onClick={() => void refresh()} title="Refresh files" aria-label="Refresh files"><RotateCw size={17}/></button>
          <button className="primary topbar-create" onClick={newEntity}><Plus size={16}/> New entity</button>
        </div>}
      </header>
      {error && <div className="notice error" role="alert">{error}</div>}
      {workspace?.errors.map((item) => <div key={item} className="notice warning" role="alert">Could not read {item}</div>)}
      {view === 'conversation' && readScope.mode === 'selected' && <div className="notice warning" role="status">Selected read scope: AI only receives chosen knowledge and this conversation. The accessible records are shown with each response.</div>}
      {view === 'review' && workspace?.proposals.some((item) => item.status === 'pending' && item.reviewReason) && <div className="notice warning" role="status">Some proposals involve similar entities. Verify the identity before accepting them.</div>}
      {!workspace ? <section className="welcome-screen"><div className="welcome-visual"><img src={serenityIcon} alt=""/><span className="visual-orbit orbit-one"/><span className="visual-orbit orbit-two"/><span className="visual-dot dot-one"/><span className="visual-dot dot-two"/><span className="visual-dot dot-three"/></div><div className="welcome-copy"><span className="eyebrow">A SPACE FOR EVERYTHING THAT MATTERS</span><h1>Your world,<br/><em>more connected.</em></h1><p>A private workspace for your knowledge, relationships, plans, and the ideas in between. Choose a folder on your device to begin.</p><button className="primary welcome-action" onClick={() => void chooseWorkspace()}><FolderOpen size={18}/> Choose a workspace <ArrowRight size={17}/></button><small>Your files stay in a folder you control.</small></div></section>
        : view === 'home' ? <HomePanel workspace={workspace} onNavigate={navigate} onSelectEntity={selectEntity} onNewEntity={newEntity} onAsk={() => startConversation()} onImport={() => { setView('documents'); void importDocuments() }} onOpenEvent={openEvent} onOpenTask={openTask} />
        : view === 'calendar' && workspace.modules.calendar ? <CalendarModule workspace={workspace} onUpdate={setWorkspace} onError={setError} focusEventId={focusedEventId} focusVersion={focusVersion} />
        : view === 'tasks' && workspace.modules.tasks ? <TasksModule workspace={workspace} onUpdate={setWorkspace} onError={setError} focusTaskId={focusedTaskId} focusVersion={focusVersion} />
        : view === 'conversation' ? <div className="conversation-layout">
          <ConversationList workspace={workspace} conversationId={conversationId} autonomy={autonomy} permissions={permissions} readScope={readScope} busy={busy}
            onNew={() => startConversation()} onSelect={selectConversation} onPermissionsChange={setPermissions} onReadScopeChange={setReadScope} onSaveSettings={() => void saveWorkflowSettings()} />
          <ConversationPanel conversation={conversation} provider={provider} onProviderChange={setProvider} autonomy={autonomy} onAutonomyChange={setAutonomy} retained={retained} onRetentionChange={setRetained} message={message} onMessageChange={setMessage} busy={busy} onSend={(event) => void sendMessage(event)} onCancel={() => void cancelMessage()} onDelete={() => void deleteConversation()} />
        </div>
        : view === 'review' ? <ReviewPanel workspace={workspace} onResolve={(id, accept) => void resolveProposal(id, accept)} onAttach={(id, entityId) => void attachProposal(id, entityId)} onOpenSource={(name) => void openDocument(name)} />
        : view === 'documents' ? <DocumentsPanel workspace={workspace} onImport={() => void importDocuments()} onOpen={(name) => void openDocument(name)} onAnalyze={(name) => startConversation(`Analyze the imported document ${name}. Summarize it, identify useful knowledge about existing entities, and suggest claims with precise sources. Ask me to clarify any ambiguous identities.`)} />
        : view === 'activity' ? <ActivityPanel workspace={workspace} activity={activity} />
        : view === 'settings' ? <SettingsPanel workspace={workspace} onUpdate={setWorkspace} onError={setError} />
        : !draft ? <section className="page knowledge-index"><div className="knowledge-index-header"><div><span className="eyebrow">YOUR WORLD</span><h1>Knowledge</h1><p>People, places, projects, ideas—whatever matters to you. Everything can connect.</p></div><button className="primary" onClick={newEntity}><Plus size={16}/> New entity</button></div>{workspace.entities.length ? <div className="knowledge-tiles">{[...workspace.entities].sort((a, b) => a.title.localeCompare(b.title)).map((entity) => <button key={entity.id} onClick={() => selectEntity(entity)}><span className="knowledge-tile-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span><ArrowRight size={16}/></button>)}</div> : <div className="knowledge-blank"><Link2 size={25}/><h2>Start with what you know.</h2><p>Create a person, project, idea, or anything else meaningful to you. Categories are yours to define.</p><button className="primary" onClick={newEntity}>Create your first entity <ArrowRight size={16}/></button></div>}</section>
          : <div className="content">
              <aside className="knowledge-list-panel"><div className="list-heading"><span className="eyebrow">LIBRARY <span className="count">{workspace.entities.length}</span></span><button className="icon-button" onClick={newEntity} aria-label="New entity" title="New entity"><Plus size={15}/></button></div>
                <nav className="entity-list" aria-label="Entities">{workspace.entities.map((entity) => <button key={entity.id} className={`entity-link ${selected === entity.id ? 'active' : ''}`} onClick={() => selectEntity(entity)}><span className="entity-icon">{entity.title.slice(0, 1).toUpperCase()}</span><span><strong>{entity.title}</strong><small>{entity.type}</small></span></button>)}</nav>
              </aside>
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
                {claims.map((item) => <ClaimCard key={item.id} claim={item} target={workspace.entities.find((entity) => entity.id === item.value)} mergedFrom={workspace.merges.find((merge) => merge.id === item.mergedFrom)} conflicting={conflicts.includes(item.key)} previousAlternative={resolvedKeys.includes(item.key)} sourceIsDocument={workspace.documents.some((document) => document.name === item.source)} onOpenSource={(name) => void openDocument(name)} onSelectTarget={selectEntity} onMarkCurrent={(id) => void markCurrent(id)} onRetract={(id) => void retractClaim(id)} />)}
                {claims.length === 0 && <p className="hint">No claims recorded yet.</p>}
                {incoming.length > 0 && <div className="incoming"><h3>Connected from elsewhere</h3>{incoming.map((link) => { const source = workspace.entities.find((entity) => entity.id === link.subject); return source && <button key={link.id} onClick={() => selectEntity(source)}>{source.title} · {link.key} ↗</button> })}</div>}
                {selected && <form className="claim-form" onSubmit={(event) => void addClaim(event)}><h3>Add a claim</h3><label htmlFor="claim-key">About or relationship</label><input id="claim-key" placeholder="e.g. birthday, friend of" required value={claim.key} onChange={(event) => setClaim({ ...claim, key: event.target.value })}/><label htmlFor="claim-value">Value</label><input id="claim-value" placeholder="e.g. September 7" required={!claimTarget} value={claim.value} onChange={(event) => setClaim({ ...claim, value: event.target.value })} disabled={Boolean(claimTarget)}/><label htmlFor="claim-target">Or link another entity</label><select id="claim-target" value={claimTarget} onChange={(event) => setClaimTarget(event.target.value)}><option value="">No entity linked</option>{workspace.entities.filter((entity) => entity.id !== selected).map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><label htmlFor="claim-source">Source</label><input id="claim-source" required value={claim.source} onChange={(event) => setClaim({ ...claim, source: event.target.value })}/><button type="submit" className="secondary">Add claim +</button></form>}
                {selected && workspace.entities.length > 1 && <div className="merge-form"><h3>Same as another entity?</h3><p>Archive this entity and resolve its links to the selected entity. Its original file and history remain available.</p><select aria-label="Merge into" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Choose the surviving entity</option>{workspace.entities.filter((entity) => entity.id !== selected).map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select><button className="secondary" disabled={!mergeTarget} onClick={() => void mergeSelected()}>Merge into selected entity</button></div>}
                {selected && workspace.merges.filter((item) => item.target === selected).map((item) => <div className="merge-form" key={item.id}><h3>Archived as {draft.title}</h3><p>{item.title} was merged here. Its original file and links can be restored without deleting the merge history.</p><button className="secondary" onClick={() => void undoMerge(item.id)}>Restore {item.title}</button></div>)}
              </aside>
            </div>}
    </main>
    <CommandPalette open={paletteOpen && Boolean(workspace)} query={query} results={results} searching={searching} provider={provider} savedIndexEnabled={Boolean(workspace?.modules.semanticIndex)} onChange={(value) => void searchText(value)} onClose={closePalette} onSelect={openSearchResult} onAISearch={() => void searchSemantically()} onSavedSearch={() => void searchSavedConcepts()} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
