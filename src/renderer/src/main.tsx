import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, FileText, FolderOpen, Maximize2, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, RotateCw, Search, Sparkles } from 'lucide-react'
import type { Autonomy, Conversation, Entity, Provider, ReadScope, SearchResult, WorkbenchSession, WorkflowPermissions, WorkspaceSnapshot } from '../../shared/types'
import { ConversationPanel } from './conversation-panel'
import { ConversationList } from './conversation-list'
import { defaultReadScope, defaultWorkflowPermissions } from '../../shared/workflow'
import { AppNavigation } from './navigation'
import { builtinViews } from './builtin-views'
import { CommandPalette } from './command-palette'
import { ThemeControl, useTheme } from './theme'
import type { View } from './views'
import { WorkspaceTabs, tabRef, type WorkspaceTab } from './workspace-tabs'
import { workspaceCommands } from './commands'
import { parseResourceUri, resourceUri } from '../../shared/resources'
import './style.css'
import './studio.css'

const serenityIcon = new URL('../../../assets/icon.svg', import.meta.url).href
function storedPanel(key: string, fallback: boolean): boolean {
  try { const stored = localStorage.getItem(key); return stored === null ? fallback : stored === 'true' }
  catch { return fallback }
}

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Entity | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pageDirty, setPageDirty] = useState(false)
  const [bodyMode, setBodyMode] = useState<'edit' | 'preview'>('edit')
  const [error, setError] = useState('')
  const [claim, setClaim] = useState({ key: '', value: '', source: 'Me' })
  const [claimTarget, setClaimTarget] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [view, setView] = useState<View>('home')
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(() => storedPanel('serenity.left-open', false))
  const [rightOpen, setRightOpen] = useState(() => storedPanel('serenity.right-open', true))
  const [aiExpanded, setAIExpanded] = useState(false)
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [sessionReadyPath, setSessionReadyPath] = useState<string | null>(null)
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
  useEffect(() => { try { localStorage.setItem('serenity.left-open', String(leftOpen)) } catch { /* Still works for this session. */ } }, [leftOpen])
  useEffect(() => { try { localStorage.setItem('serenity.right-open', String(rightOpen)) } catch { /* Still works for this session. */ } }, [rightOpen])
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1020px)')
    const onChange = (): void => { if (window.innerWidth <= 1020) setLeftOpen(false) }
    onChange()
    narrow.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => { narrow.removeEventListener('change', onChange); window.removeEventListener('resize', onChange) }
  }, [])

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
  useEffect(() => window.serenity.setEditorDirty(dirty || pageDirty), [dirty, pageDirty])
  useEffect(() => window.serenity.onIndexError((message) => setError(`Background AI: ${message}`)), [])
  useEffect(() => {
    if (!workspace) return
    let current = true
    setSessionReadyPath(null)
    const restoreConversation = (last: Conversation | undefined): void => {
      setConversationId(last?.id ?? null)
      setAutonomy(last?.autonomy ?? 'propose')
      setPermissions(last?.permissions ?? { ...defaultWorkflowPermissions })
      setReadScope(last?.readScope ?? { ...defaultReadScope, entityIds: [], documentNames: [] })
      setRetained(last?.retained ?? true)
    }
    void window.serenity.loadSession().then((session) => {
      if (!current) return
      if (!session) { restoreConversation(workspace.conversations.at(-1)); setSessionReadyPath(workspace.path); return }
      const lastConversation = workspace.conversations.find((item) => session.assistantUri === resourceUri({ kind: 'conversation', id: item.id })) ?? workspace.conversations.at(-1)
      restoreConversation(lastConversation)
      const open: WorkspaceTab[] = session.openUris.flatMap<WorkspaceTab>((uri) => {
        const ref = parseResourceUri(uri)
        if (ref?.kind === 'entity') {
          const entity = workspace.entities.find((item) => item.id === ref.id)
          return entity ? [{ kind: 'entity', id: ref.id, title: entity.title }] : []
        }
        if (ref?.kind === 'document') {
          const document = workspace.documents.find((item) => item.name === ref.id)
          return document ? [{ kind: 'document', id: ref.id, title: document.name }] : []
        }
        return []
      })
      const active = session.activeUri ? parseResourceUri(session.activeUri) : null
      const target = session.view as View
      setTabs(open)
      if (active?.kind === 'entity' && target === 'knowledge') {
        const entity = workspace.entities.find((item) => item.id === active.id)
        if (entity) { setSelected(entity.id); setDraft(entity); setBodyMode('preview'); setActiveTab(`entity:${entity.id}`) }
      } else if (active?.kind === 'document' && target === 'documents') setActiveTab(`document:${active.id}`)
      else if (active?.kind === 'page' && target === 'home') setActivePageId(active.id === workspace.workbench.homePage ? null : active.id)
      setView(builtinViews.available(target, { workspace }) ? target : 'home')
      setSessionReadyPath(workspace.path)
    }).catch((error) => { if (current) setError(`Workspace session: ${String(error)}`) })
    return () => { current = false }
  }, [workspace?.path])
  useEffect(() => {
    if (!workspace || sessionReadyPath !== workspace.path) return
    const selectedTab = tabs.find((tab) => tabRef(tab) === activeTab)
    const session: WorkbenchSession = { view, openUris: tabs.map((tab) => resourceUri(tab)),
      assistantUri: conversationId ? resourceUri({ kind: 'conversation', id: conversationId }) : undefined,
      activeUri: view === 'home' ? resourceUri({ kind: 'page', id: activePageId ?? workspace.workbench.homePage }) :
        selectedTab ? resourceUri(selectedTab) : undefined }
    const timer = window.setTimeout(() => { void window.serenity.saveSession(session).catch((error) => setError(`Workspace session: ${String(error)}`)) }, 180)
    return () => window.clearTimeout(timer)
  }, [workspace?.path, workspace?.workbench.homePage, sessionReadyPath, view, tabs, activeTab, activePageId, conversationId])
  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (paletteOpen) closePalette()
        else setPaletteOpen(true)
      } else if ((event.metaKey || event.ctrlKey) && !event.repeat && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setLeftOpen((open) => !open)
      } else if ((event.metaKey || event.ctrlKey) && !event.repeat && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setRightOpen((open) => !open)
        setAIExpanded(false)
      } else if (event.key === 'Escape') {
        if (paletteOpen) closePalette()
        else if (leftOpen) setLeftOpen(false)
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [closePalette, paletteOpen, leftOpen])

  async function chooseWorkspace() {
    try {
      const next = await window.serenity.chooseWorkspace()
      if (!next) return
      setWorkspace(next)
      setSessionReadyPath(null)
      setSelected(null)
      setDraft(null)
      setDirty(false)
      setPageDirty(false)
      setBodyMode('edit')
      setError('')
      setView('home')
      setActivePageId(null)
      setTabs([])
      setActiveTab(null)
      setAIExpanded(false)
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
    if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved Home page changes?')) return false
    if (dirty && !window.confirm('Discard your unsaved changes?')) return false
    setPageDirty(false)
    setSelected(entity.id)
    setDraft({ ...entity })
    setDirty(false)
    setBodyMode('preview')
    setError('')
    setView('knowledge')
    const tab: WorkspaceTab = { kind: 'entity', id: entity.id, title: entity.title }
    setTabs((existing) => existing.some((item) => tabRef(item) === tabRef(tab)) ? existing.map((item) => tabRef(item) === tabRef(tab) ? tab : item) : [...existing, tab])
    setActiveTab(tabRef(tab))
    return true
  }

  function newEntity() {
    if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved Home page changes?')) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setPageDirty(false)
    setSelected(null)
    setDraft({ id: '', title: '', type: '', body: '' })
    setDirty(false)
    setBodyMode('edit')
    setError('')
    setView('knowledge')
    setActiveTab(null)
  }

  function startConversation(prompt = '') {
    if (message.trim() && !window.confirm('Discard your unsent message?')) return
    setConversationId(null)
    setAutonomy('propose')
    setPermissions({ ...defaultWorkflowPermissions })
    setReadScope({ ...defaultReadScope, entityIds: [], documentNames: [] })
    setRetained(true)
    setMessage(prompt)
    setRightOpen(true)
    setAIExpanded(false)
  }

  function selectConversation(item: Conversation) {
    if (busy || (message.trim() && item.id !== conversationId && !window.confirm('Discard your unsent message?'))) return
    setConversationId(item.id)
    setRetained(item.retained)
    setAutonomy(item.autonomy ?? 'propose')
    setPermissions(item.permissions ?? { ...defaultWorkflowPermissions })
    setReadScope(item.readScope ?? { ...defaultReadScope, entityIds: [], documentNames: [] })
    setMessage('')
    setRightOpen(true)
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
      if (saved) {
        const tab: WorkspaceTab = { kind: 'entity', id: saved.id, title: saved.title }
        setTabs((existing) => existing.some((item) => tabRef(item) === tabRef(tab)) ? existing.map((item) => tabRef(item) === tabRef(tab) ? tab : item) : [...existing, tab])
        setActiveTab(tabRef(tab))
      }
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
    const id = result.kind === 'claim' ? workspace?.claims.find((claim) => claim.id === result.id)?.subject ?? result.id : result.id
    if (openResource(resourceUri({ kind: result.kind === 'claim' ? 'entity' : result.kind, id }))) closePalette()
  }

  function openResource(uri: string): boolean {
    const ref = parseResourceUri(uri)
    if (!ref || !workspace) return false
    if (ref.kind === 'entity') {
      const entity = workspace.entities.find((item) => item.id === ref.id)
      return entity ? selectEntity(entity) : false
    }
    if (ref.kind === 'document' && workspace.documents.some((item) => item.name === ref.id)) { openDocumentTab(ref.id); return true }
    if (ref.kind === 'task' && workspace.modules.tasks && workspace.tasks.some((item) => item.id === ref.id)) { openTask(ref.id); return true }
    if (ref.kind === 'event' && workspace.modules.calendar && workspace.events.some((item) => item.id === ref.id)) { openEvent(ref.id); return true }
    if (ref.kind === 'claim') {
      const subject = workspace.claims.find((item) => item.id === ref.id)?.subject
      return subject ? openResource(resourceUri({ kind: 'entity', id: subject })) : false
    }
    if (ref.kind === 'conversation') {
      const conversation = workspace.conversations.find((item) => item.id === ref.id)
      if (conversation) { selectConversation(conversation); return true }
    }
    if (ref.kind === 'proposal' && workspace.proposals.some((item) => item.id === ref.id)) { navigate('review'); return true }
    if (ref.kind === 'page' && workspace.pages.some((page) => page.id === ref.id)) {
      runCommand(`page.open.${ref.id}`)
      return true
    }
    return false
  }

  function openEvent(id: string) {
    if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved Home page changes?')) return
    setPageDirty(false)
    setFocusedEventId(id)
    setFocusVersion((version) => version + 1)
    setView('calendar')
  }

  function openTask(id: string) {
    if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved Home page changes?')) return
    setPageDirty(false)
    setFocusedTaskId(id)
    setFocusVersion((version) => version + 1)
    setView('tasks')
  }

  function navigate(destination: View) {
    if (view === 'home' && pageDirty && (destination !== 'home' || activePageId !== null)) {
      if (!window.confirm('Discard your unsaved Home page changes?')) return
      setPageDirty(false)
    }
    if (destination === 'home') setActivePageId(null)
    if (destination === 'knowledge') {
      if (view === 'knowledge' && selected) {
        if (dirty && !window.confirm('Discard your unsaved changes?')) return
        setSelected(null)
        setDraft(null)
        setDirty(false)
        setActiveTab(null)
      } else setActiveTab(selected ? `entity:${selected}` : null)
    } else setActiveTab(null)
    if (destination === 'calendar') setFocusedEventId(null)
    if (destination === 'tasks') setFocusedTaskId(null)
    setView(destination)
    if (leftOpen) setLeftOpen(false)
    if (destination === 'activity') void refresh()
  }

  function runCommand(id: string): void {
    const command = workspace && workspaceCommands(workspace).find((item) => item.id === id)
    if (!command) return
    if (id.startsWith('page.open.')) {
      const pageId = id.slice('page.open.'.length)
      if (!workspace?.pages.some((page) => page.id === pageId)) return
      if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved page changes?')) return
      setPageDirty(false)
      setActivePageId(pageId)
      setActiveTab(null)
      setView('home')
      if (leftOpen) setLeftOpen(false)
      return
    }
    if (command.view) { navigate(command.view); return }
    if (id === 'entity.create') newEntity()
    else if (id === 'page.create') void createPage()
    else if (id === 'documents.import') {
      if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved Home page changes?')) return
      setPageDirty(false)
      setView('documents'); void importDocuments()
    }
    else if (id === 'assistant.new') startConversation()
    else if (id === 'workspace.search') setPaletteOpen(true)
    else if (id === 'workspace.refresh') void refresh()
  }

  async function createPage(): Promise<void> {
    if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved page changes?')) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    try {
      const before = new Set(workspace?.pages.map((page) => page.id) ?? [])
      const next = await window.serenity.createPage()
      const created = next.pages.find((page) => !before.has(page.id))
      if (!created) throw new Error('New page was not found in this workspace')
      setWorkspace(next)
      setPageDirty(false)
      setDirty(false)
      setActiveTab(null)
      setActivePageId(created.id)
      setView('home')
      setError('')
    } catch (error) { setError(String(error)) }
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

  function openDocumentTab(name: string) {
    const item = workspace?.documents.find((document) => document.name === name)
    if (!item) return
    if (!item.extractable) { void openDocument(name); return }
    if (view === 'home' && pageDirty && !window.confirm('Discard your unsaved Home page changes?')) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setPageDirty(false)
    const tab: WorkspaceTab = { kind: 'document', id: name, title: name }
    setTabs((existing) => existing.some((entry) => tabRef(entry) === tabRef(tab)) ? existing : [...existing, tab])
    setActiveTab(tabRef(tab))
    setView('documents')
    setDirty(false)
  }

  function activateTab(tab: WorkspaceTab) {
    if (tab.kind === 'entity') {
      const entity = workspace?.entities.find((item) => item.id === tab.id)
      if (entity) selectEntity(entity)
      return
    }
    openDocumentTab(tab.id)
  }

  function closeTab(tab: WorkspaceTab) {
    const remaining = tabs.filter((item) => tabRef(item) !== tabRef(tab))
    if (activeTab === tabRef(tab) && dirty && !window.confirm('Discard your unsaved changes?')) return
    setTabs(remaining)
    if (activeTab === tabRef(tab)) {
      setActiveTab(null)
      setSelected(null)
      setDraft(null)
      setDirty(false)
      setView(tab.kind === 'document' ? 'documents' : 'knowledge')
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!message.trim() || busy) return
    if (autonomy === 'ask' && !window.confirm(`Allow ${provider} to read this workspace for this request? No knowledge changes will be saved without separate approval.`)) return
    setBusy(true)
    try {
      const next = await window.serenity.sendMessage({ conversationId: conversationId ?? undefined, text: message, provider, autonomy, retained, permissions, readScope,
        activeRef: view === 'home' ? `page:${activePageId ?? workspace?.workbench.homePage ?? 'home'}` : activeTab ?? undefined, openRefs: tabs.map(tabRef) })
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

  const conversation = workspace?.conversations.find((item) => item.id === conversationId)
  const pending = workspace?.proposals.filter((proposal) => proposal.status === 'pending') ?? []
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
  const title: Record<View, string> = { home: 'Home', knowledge: 'Knowledge', review: 'Review', documents: 'Documents', calendar: 'Calendar', tasks: 'Tasks', activity: 'Activity', settings: 'Settings' }
  const currentTab = tabs.find((item) => tabRef(item) === activeTab)
  const currentPage = view === 'home' ? workspace?.pages.find((item) => item.id === (activePageId ?? workspace.workbench.homePage)) : null
  const activeFile = currentTab && workspace ? {
    name: currentTab.title,
    path: `${currentTab.kind === 'entity' ? 'entities' : 'documents'}/${currentTab.id}${currentTab.kind === 'entity' ? '.md' : ''}`,
    kind: currentTab.kind,
    allowed: readScope.mode === 'workspace' || (currentTab.kind === 'entity' ? readScope.entityIds.includes(currentTab.id) : readScope.documentNames.includes(currentTab.id))
  } : currentPage ? { name: currentPage.title, path: currentPage.path, kind: 'page' as const, allowed: readScope.mode === 'workspace' } : undefined

  return <div className={`app serenity-studio ${leftOpen ? 'dock-open' : 'left-collapsed'} ${rightOpen ? '' : 'right-collapsed'} ${aiExpanded && rightOpen ? 'ai-expanded' : ''}`}>
    <aside className="sidebar" aria-label="Workspace sidebar">
      <div className="sidebar-inner">
      <div className="brand"><img className="brand-icon" src={serenityIcon} alt=""/><div><strong>Serenity</strong></div></div>
      <button className="left-rail-toggle" onClick={() => setLeftOpen(!leftOpen)} aria-label={leftOpen ? 'Collapse navigation' : 'Expand navigation'} aria-keyshortcuts={navigator.platform.includes('Mac') ? 'Meta+B' : 'Control+B'} title={`${leftOpen ? 'Collapse' : 'Expand'} navigation (${navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})`}>{leftOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={19}/>}</button>
      <div className="workspace-control">
        <button className="workspace-button" onClick={() => void chooseWorkspace()} title={workspace?.path ?? 'Choose a workspace'}>
          <span className="workspace-avatar">{workspace ? workspace.path.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 1).toUpperCase() : '+'}</span>
          <span className="workspace-info"><strong>{workspace ? workspace.path.split(/[\\/]/).filter(Boolean).at(-1) : 'Choose a folder'}</strong><small>{workspace ? 'Local workspace' : 'Start here'}</small></span>
          <span className="workspace-chevron">⌄</span>
        </button>
        {workspace && <small className="workspace-path" title={workspace.path}>{workspace.path}</small>}
      </div>
      {workspace && <div className="sidebar-scroller">
        <AppNavigation view={view} activePageId={activePageId} pendingCount={pending.length} commands={workspaceCommands(workspace)} navigation={workspace.workbench.navigation} onCommand={runCommand}/>
      </div>}
      <div className="sidebar-footer" inert={!leftOpen}>
        {workspace && <button className="footer-folder" onClick={() => void window.serenity.openWorkspaceFolder().catch((cause) => setError(String(cause)))}><FolderOpen size={16}/> Open workspace folder</button>}
        <ThemeControl preference={theme} onChange={setTheme}/>
      </div>
      </div>
    </aside>
    <div className="workbench">
    <main className="main" id="workspace-main">
      <header className="topbar">
        <div className="breadcrumbs"><strong>{workspace ? view === 'home' ? currentPage?.title ?? 'Home' : title[view] : 'Welcome'}</strong></div>
        {workspace && <div className="topbar-actions">
          <button className="topbar-search" onClick={() => runCommand('workspace.search')} title={`Search workspace (${navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl+K'})`} aria-label="Search workspace"><Search size={18}/></button>
          {!rightOpen && <button className="topbar-icon show-ai" onClick={() => setRightOpen(true)} title={`Show AI assistant (${navigator.platform.includes('Mac') ? '⌘J' : 'Ctrl+J'})`} aria-label="Show AI sidebar" aria-keyshortcuts={navigator.platform.includes('Mac') ? 'Meta+J' : 'Control+J'}><PanelRightOpen size={18}/></button>}
          <details className="topbar-more"><summary aria-label="Workspace actions" title="Workspace actions"><MoreHorizontal size={19}/></summary><div className="topbar-menu"><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('entity.create') }}><Plus size={15}/> New entity</button><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('page.create') }}><FileText size={15}/> New page</button><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('workspace.refresh') }}><RotateCw size={15}/> Refresh files</button></div></details>
        </div>}
      </header>
      {workspace && <WorkspaceTabs tabs={tabs} active={activeTab} onSelect={activateTab} onClose={closeTab}/>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {workspace?.errors.map((item) => <div key={item} className="notice warning" role="alert">Could not read {item}</div>)}
      {view === 'review' && workspace?.proposals.some((item) => item.status === 'pending' && item.reviewReason) && <div className="notice warning" role="status">Some proposals involve similar entities. Verify the identity before accepting them.</div>}
      <div className="workspace-body" key={`${view}:${activeTab ?? ''}`}>
      {!workspace ? <section className="welcome-screen"><div className="welcome-visual"><img src={serenityIcon} alt=""/><span className="visual-orbit orbit-one"/><span className="visual-orbit orbit-two"/><span className="visual-dot dot-one"/><span className="visual-dot dot-two"/><span className="visual-dot dot-three"/></div><div className="welcome-copy"><span className="eyebrow">A SPACE FOR EVERYTHING THAT MATTERS</span><h1>Your world,<br/><em>more connected.</em></h1><p>A private workspace for your knowledge, relationships, plans, and the ideas in between. Choose a folder on your device to begin.</p><button className="primary welcome-action" onClick={() => void chooseWorkspace()}><FolderOpen size={18}/> Choose a workspace <ArrowRight size={17}/></button><small>Your files stay in a folder you control.</small></div></section>
          : builtinViews.render(view, { workspace, page: currentPage ?? undefined, commands: workspaceCommands(workspace),
            activeDocument: currentTab?.kind === 'document' ? currentTab.id : undefined, focusedEventId, focusedTaskId, focusVersion, activity,
            onUpdate: setWorkspace, onError: setError, onDirtyChange: setPageDirty, onOpenResource: (uri) => { openResource(uri) }, onCommand: runCommand,
            onResolve: (id, accept) => { void resolveProposal(id, accept) }, onAttach: (id, entityId) => { void attachProposal(id, entityId) },
            onOpenSource: (name) => { void openDocument(name) }, onImport: () => { void importDocuments() }, onOpenDocument: openDocumentTab,
            onAnalyze: (name) => { openDocumentTab(name); startConversation(`Analyze the imported document ${name}. Summarize it, identify useful knowledge about existing entities, and suggest claims with precise sources. Ask me to clarify any ambiguous identities.`) },
            knowledge: { workspace, selected, draft, dirty, bodyMode, claim, claimTarget, mergeTarget,
              onSelectEntity: selectEntity, onNewEntity: newEntity,
              onDraftChange: (entity) => { setDraft(entity); setDirty(true) }, onBodyModeChange: setBodyMode,
              onSave: (event) => { void saveEntity(event) }, onClaimChange: setClaim, onClaimTargetChange: setClaimTarget,
              onAddClaim: (event) => { void addClaim(event) }, onMarkCurrent: (id) => { void markCurrent(id) }, onRetract: (id) => { void retractClaim(id) },
              onClearCurrent: (key) => { void clearCurrent(key) }, onDiscuss: startConversation, onOpenSource: (name) => { void openDocument(name) },
              onMergeTargetChange: setMergeTarget, onMerge: () => { void mergeSelected() }, onUndoMerge: (id) => { void undoMerge(id) } }
          }) ?? <section className="page"><h1>View unavailable</h1><p>This module is not available in this workspace.</p></section>}
      </div>
    </main>
    {workspace && (rightOpen ? <aside className="assistant-sidebar" aria-label="AI assistant">
      <div className="assistant-toolbar"><div><Sparkles size={18}/><span>Assistant</span><small>WITH YOUR WORKSPACE</small></div><div className="assistant-toolbar-actions">
        <button onClick={() => setAIExpanded(!aiExpanded)} aria-label={aiExpanded ? 'Return AI to sidebar' : 'Expand AI over workspace'} title={aiExpanded ? 'Return AI to sidebar' : 'Expand AI over workspace'}>{aiExpanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
        <button onClick={() => { setRightOpen(false); setAIExpanded(false) }} aria-label="Collapse AI sidebar" aria-keyshortcuts={navigator.platform.includes('Mac') ? 'Meta+J' : 'Control+J'} title={`Collapse AI sidebar (${navigator.platform.includes('Mac') ? '⌘J' : 'Ctrl+J'})`}><PanelRightClose size={17}/></button>
      </div></div>
      <ConversationList workspace={workspace} conversationId={conversationId} autonomy={autonomy} permissions={permissions} readScope={readScope} busy={busy}
        onNew={() => runCommand('assistant.new')} onSelect={selectConversation} onPermissionsChange={setPermissions} onReadScopeChange={setReadScope} onSaveSettings={() => void saveWorkflowSettings()} />
      {readScope.mode === 'selected' && <div className="ai-scope-note" role="status">Selected knowledge only · review allowed files in Workflow settings</div>}
      <ConversationPanel conversation={conversation} provider={provider} onProviderChange={setProvider} autonomy={autonomy} onAutonomyChange={setAutonomy} retained={retained} onRetentionChange={setRetained} message={message} onMessageChange={setMessage} busy={busy} onSend={(event) => void sendMessage(event)} onCancel={() => void cancelMessage()} onDelete={() => void deleteConversation()} activeFile={activeFile} openFileCount={tabs.length} />
    </aside> : <aside className="assistant-rail" aria-label="AI assistant collapsed"><button onClick={() => setRightOpen(true)} title="Expand AI sidebar" aria-label="Expand AI sidebar"><PanelRightOpen size={20}/></button><span>AI</span></aside>)}
    </div>
    <CommandPalette open={paletteOpen && Boolean(workspace)} query={query} results={results} searching={searching} provider={provider} savedIndexEnabled={Boolean(workspace?.modules.semanticIndex)} commands={workspace ? workspaceCommands(workspace) : []} onChange={(value) => void searchText(value)} onClose={closePalette} onSelect={openSearchResult} onAISearch={() => void searchSemantically()} onSavedSearch={() => void searchSavedConcepts()} onCommand={runCommand} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
