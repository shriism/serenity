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
import { WorkspaceTabs } from './workspace-tabs'
import { restoreTabs, routeResource, tabKey, tabPath, tabTitle, tabUri, tabView, type TabRef } from './resource-routing'
import { knownCommandIds, workspaceCommands, type CommandContribution, type CommandHost } from './commands'
import { eventKeybinding, formatKeybinding, resolveKeymap, type KeymapResult } from '../../shared/keybindings'
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
  const [leftOpen, setLeftOpen] = useState(() => storedPanel('serenity.left-open', false))
  const [rightOpen, setRightOpen] = useState(() => storedPanel('serenity.right-open', true))
  const [aiExpanded, setAIExpanded] = useState(false)
  const [tabs, setTabs] = useState<TabRef[]>([])
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
  const commandContext = useRef<{ host: CommandHost; commands: CommandContribution[]; keymap: KeymapResult; escape(): void } | null>(null)
  const activeTabRef = tabs.find((tab) => tabKey(tab) === activeTab)
  const activePageId = view === 'home' && activeTabRef?.kind === 'page' ? activeTabRef.id : null
  const viewAvailable = (target: View): boolean => Boolean(workspace && builtinViews.available(target, { workspace }))
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
      const available = (id: View): boolean => builtinViews.available(id, { workspace })
      const open = restoreTabs(workspace, session.openUris, available)
      const active = session.activeUri ? routeResource(workspace, session.activeUri, available) : null
      const target = available(session.view as View) ? session.view as View : 'home'
      if (active?.action === 'tab' && active.view === target) {
        const tab = active.tab
        setTabs(open.some((item) => tabKey(item) === tabKey(tab)) ? open : [...open, tab])
        setActiveTab(tabKey(tab))
        const entity = tab.kind === 'entity' ? workspace.entities.find((item) => item.id === tab.id) : undefined
        if (entity) { setSelected(entity.id); setDraft(entity); setBodyMode('preview') }
      } else setTabs(open)
      setView(target)
      setSessionReadyPath(workspace.path)
    }).catch((error) => { if (current) setError(`Workspace session: ${String(error)}`) })
    return () => { current = false }
  }, [workspace?.path])
  useEffect(() => {
    if (!workspace || sessionReadyPath !== workspace.path) return
    const session: WorkbenchSession = { view, openUris: tabs.slice(-30).map(tabUri),
      assistantUri: conversationId ? resourceUri({ kind: 'conversation', id: conversationId }) : undefined,
      activeUri: activeTabRef && tabView[activeTabRef.kind] === view ? tabUri(activeTabRef) :
        view === 'home' ? resourceUri({ kind: 'page', id: workspace.workbench.homePage }) : undefined }
    const timer = window.setTimeout(() => { void window.serenity.saveSession(session).catch((error) => setError(`Workspace session: ${String(error)}`)) }, 180)
    return () => window.clearTimeout(timer)
  }, [workspace?.path, workspace?.workbench.homePage, sessionReadyPath, view, tabs, activeTab, activeTabRef, conversationId])
  useEffect(() => {
    if (!workspace) return
    const available = (id: View): boolean => builtinViews.available(id, { workspace })
    setTabs((existing) => {
      const kept = restoreTabs(workspace, existing.map(tabUri), available)
      return kept.length === existing.length ? existing : kept
    })
  }, [workspace])
  useEffect(() => {
    const mac = navigator.platform.includes('Mac')
    const onShortcut = (event: globalThis.KeyboardEvent): void => {
      const current = commandContext.current
      if (!current) return
      if (event.key === 'Escape') { current.escape(); return }
      const binding = eventKeybinding(event, mac)
      const id = binding ? current.keymap.bindings.get(binding) : undefined
      const command = id ? current.commands.find((item) => item.id === id) : undefined
      if (!command || event.repeat) return
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')
      if (typing && !command.whileTyping) return
      event.preventDefault()
      command.run(current.host)
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

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

  function confirmLeavePage(): boolean {
    if (!pageDirty) return true
    if (!window.confirm('Discard your unsaved page changes?')) return false
    setPageDirty(false)
    return true
  }

  function confirmDiscardDraft(): boolean {
    if (!dirty) return true
    if (!window.confirm('Discard your unsaved changes?')) return false
    setDirty(false)
    return true
  }

  function openTab(tab: TabRef): void {
    setTabs((existing) => existing.some((item) => tabKey(item) === tabKey(tab)) ? existing : [...existing, tab])
    setActiveTab(tabKey(tab))
  }

  function selectEntity(entity: Entity): boolean {
    if (!confirmLeavePage()) return false
    if (entity.id === selected && draft) {
      setView('knowledge')
      openTab({ kind: 'entity', id: entity.id })
      return true
    }
    if (!confirmDiscardDraft()) return false
    setSelected(entity.id)
    setDraft({ ...entity })
    setBodyMode('preview')
    setError('')
    setView('knowledge')
    openTab({ kind: 'entity', id: entity.id })
    return true
  }

  function newEntity() {
    if (!confirmLeavePage() || !confirmDiscardDraft()) return
    setSelected(null)
    setDraft({ id: '', title: '', type: '', body: '' })
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
        openTab({ kind: 'entity', id: saved.id })
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
    // The search index records claim hits under their subject entity's ID.
    const kind = result.kind === 'claim' && !workspace?.claims.some((item) => item.id === result.id) ? 'entity' : result.kind
    if (openResource(resourceUri({ kind, id: result.id }))) closePalette()
  }

  function openResource(uri: string): boolean {
    const target = workspace ? routeResource(workspace, uri, viewAvailable) : null
    if (!workspace || !target) return false
    switch (target.action) {
      case 'tab': return openTabRef(target.tab)
      case 'home': return navigate('home')
      case 'focus': return focusRecord(target.kind, target.id)
      case 'external': void openDocument(target.name); return true
      case 'view': return navigate(target.view)
      case 'conversation': {
        const conversation = workspace.conversations.find((item) => item.id === target.id)
        if (conversation) selectConversation(conversation)
        return Boolean(conversation)
      }
    }
  }

  function openTabRef(tab: TabRef): boolean {
    if (tab.kind === 'document') return openDocumentTab(tab.id)
    if (tab.kind === 'page') return openPageTab(tab.id)
    const entity = workspace?.entities.find((item) => item.id === tab.id)
    return entity ? selectEntity(entity) : false
  }

  function openPageTab(id: string): boolean {
    if (activePageId !== id && !confirmLeavePage()) return false
    openTab({ kind: 'page', id })
    setView('home')
    return true
  }

  function focusRecord(kind: 'task' | 'event', id: string): boolean {
    if (!confirmLeavePage()) return false
    if (kind === 'task') setFocusedTaskId(id)
    else setFocusedEventId(id)
    setFocusVersion((version) => version + 1)
    setActiveTab(null)
    setView(kind === 'task' ? 'tasks' : 'calendar')
    return true
  }

  function navigate(destination: View): boolean {
    if (!viewAvailable(destination)) return false
    if (view === 'home' && (destination !== 'home' || activePageId !== null) && !confirmLeavePage()) return false
    if (destination === 'knowledge') {
      if (view === 'knowledge' && selected) {
        if (!confirmDiscardDraft()) return false
        setSelected(null)
        setDraft(null)
        setActiveTab(null)
      } else setActiveTab(selected ? tabKey({ kind: 'entity', id: selected }) : null)
    } else setActiveTab(null)
    if (destination === 'calendar') setFocusedEventId(null)
    if (destination === 'tasks') setFocusedTaskId(null)
    setView(destination)
    if (leftOpen) setLeftOpen(false)
    if (destination === 'activity') void refresh()
    return true
  }

  function runCommand(id: string): void {
    commands.find((item) => item.id === id)?.run(commandHost)
  }

  async function createPage(): Promise<void> {
    if (!confirmLeavePage()) return
    try {
      const before = new Set(workspace?.pages.map((page) => page.id) ?? [])
      const next = await window.serenity.createPage()
      const created = next.pages.find((page) => !before.has(page.id))
      if (!created) throw new Error('New page was not found in this workspace')
      setWorkspace(next)
      openTab({ kind: 'page', id: created.id })
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

  function openDocumentTab(name: string): boolean {
    const item = workspace?.documents.find((document) => document.name === name)
    if (!item) return false
    if (!item.extractable) { void openDocument(name); return true }
    if (!confirmLeavePage()) return false
    openTab({ kind: 'document', id: name })
    setView('documents')
    return true
  }

  function activateTab(key: string) {
    const tab = tabs.find((item) => tabKey(item) === key)
    if (tab) openTabRef(tab)
  }

  function closeTab(key: string) {
    const tab = tabs.find((item) => tabKey(item) === key)
    if (!tab) return
    const editing = tab.kind === 'entity' && tab.id === selected
    if (editing && !confirmDiscardDraft()) return
    if (activeTab === key && tab.kind === 'page' && !confirmLeavePage()) return
    setTabs(tabs.filter((item) => tabKey(item) !== key))
    if (editing) { setSelected(null); setDraft(null) }
    if (activeTab === key) { setActiveTab(null); setView(tabView[tab.kind]) }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!message.trim() || busy) return
    if (autonomy === 'ask' && !window.confirm(`Allow ${provider} to read this workspace for this request? No knowledge changes will be saved without separate approval.`)) return
    setBusy(true)
    try {
      const next = await window.serenity.sendMessage({ conversationId: conversationId ?? undefined, text: message, provider, autonomy, retained, permissions, readScope,
        activeRef: view === 'home' ? `page:${activePageId ?? workspace?.workbench.homePage ?? 'home'}` : activeTab ?? undefined, openRefs: tabs.map(tabKey) })
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

  const commands = workspace ? workspaceCommands(workspace) : []
  const keymap = resolveKeymap(commands, workspace?.workbench.keybindings, workspace ? knownCommandIds(workspace) : undefined)
  const mac = navigator.platform.includes('Mac')
  const shortcut = (id: string): string | undefined => { const binding = keymap.byCommand.get(id); return binding && formatKeybinding(binding, mac) }
  const ariaShortcut = (id: string): string | undefined => keymap.byCommand.get(id)?.replace('Mod', mac ? 'Meta' : 'Control').replace('Ctrl', 'Control')
  const withShortcut = (label: string, id: string): string => { const keys = shortcut(id); return keys ? `${label} (${keys})` : label }
  const commandHost: CommandHost = {
    navigate,
    openResource: (uri) => { const opened = openResource(uri); if (opened && leftOpen) setLeftOpen(false); return opened },
    newEntity,
    createPage: () => { void createPage() },
    importDocuments: () => { if (navigate('documents')) void importDocuments() },
    newConversation: () => startConversation(),
    toggleSearch: () => { if (paletteOpen) closePalette(); else setPaletteOpen(true) },
    toggleNavigation: () => setLeftOpen((open) => !open),
    toggleAssistant: () => { setRightOpen((open) => !open); setAIExpanded(false) },
    refresh: () => { void refresh() }
  }
  commandContext.current = { host: commandHost, commands, keymap, escape: () => { if (paletteOpen) closePalette(); else if (leftOpen) setLeftOpen(false) } }

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
  const currentTab = activeTabRef
  const currentPage = view === 'home' ? workspace?.pages.find((item) => item.id === (activePageId ?? workspace.workbench.homePage)) : null
  const activeFile = currentTab && currentTab.kind !== 'page' && workspace ? {
    name: tabTitle(workspace, currentTab),
    path: tabPath(workspace, currentTab),
    kind: currentTab.kind,
    allowed: readScope.mode === 'workspace' || (currentTab.kind === 'entity' ? readScope.entityIds.includes(currentTab.id) : readScope.documentNames.includes(currentTab.id))
  } : currentPage ? { name: currentPage.title, path: currentPage.path, kind: 'page' as const, allowed: readScope.mode === 'workspace' } : undefined

  return <div className={`app serenity-studio ${leftOpen ? 'dock-open' : 'left-collapsed'} ${rightOpen ? '' : 'right-collapsed'} ${aiExpanded && rightOpen ? 'ai-expanded' : ''}`}>
    <aside className="sidebar" aria-label="Workspace sidebar">
      <div className="sidebar-inner">
      <div className="brand"><img className="brand-icon" src={serenityIcon} alt=""/><div><strong>Serenity</strong></div></div>
      <button className="left-rail-toggle" onClick={() => setLeftOpen(!leftOpen)} aria-label={leftOpen ? 'Collapse navigation' : 'Expand navigation'} aria-keyshortcuts={ariaShortcut('navigation.toggle')} title={withShortcut(`${leftOpen ? 'Collapse' : 'Expand'} navigation`, 'navigation.toggle')}>{leftOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={19}/>}</button>
      <div className="workspace-control">
        <button className="workspace-button" onClick={() => void chooseWorkspace()} title={workspace?.path ?? 'Choose a workspace'}>
          <span className="workspace-avatar">{workspace ? workspace.path.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 1).toUpperCase() : '+'}</span>
          <span className="workspace-info"><strong>{workspace ? workspace.path.split(/[\\/]/).filter(Boolean).at(-1) : 'Choose a folder'}</strong><small>{workspace ? 'Local workspace' : 'Start here'}</small></span>
          <span className="workspace-chevron">⌄</span>
        </button>
        {workspace && <small className="workspace-path" title={workspace.path}>{workspace.path}</small>}
      </div>
      {workspace && <div className="sidebar-scroller">
        <AppNavigation view={view} activePageId={activePageId} pendingCount={pending.length} commands={commands} navigation={workspace.workbench.navigation} onCommand={runCommand}/>
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
          <button className="topbar-search" onClick={() => runCommand('workspace.search')} title={withShortcut('Search workspace', 'workspace.search')} aria-label="Search workspace"><Search size={18}/></button>
          {!rightOpen && <button className="topbar-icon show-ai" onClick={() => setRightOpen(true)} title={withShortcut('Show AI assistant', 'assistant.toggle')} aria-label="Show AI sidebar" aria-keyshortcuts={ariaShortcut('assistant.toggle')}><PanelRightOpen size={18}/></button>}
          <details className="topbar-more"><summary aria-label="Workspace actions" title="Workspace actions"><MoreHorizontal size={19}/></summary><div className="topbar-menu"><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('entity.create') }}><Plus size={15}/> New entity</button><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('page.create') }}><FileText size={15}/> New page</button><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('workspace.refresh') }}><RotateCw size={15}/> Refresh files</button></div></details>
        </div>}
      </header>
      {workspace && <WorkspaceTabs tabs={tabs.map((tab) => ({ key: tabKey(tab), kind: tab.kind, title: tabTitle(workspace, tab) }))} active={activeTab} onSelect={activateTab} onClose={closeTab}/>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {workspace?.errors.map((item) => <div key={item} className="notice warning" role="alert">Could not read {item}</div>)}
      {keymap.problems.map((item) => <div key={item} className="notice warning" role="alert">.serenity/workbench.yaml: {item}</div>)}
      {view === 'review' && workspace?.proposals.some((item) => item.status === 'pending' && item.reviewReason) && <div className="notice warning" role="status">Some proposals involve similar entities. Verify the identity before accepting them.</div>}
      <div className="workspace-body" key={`${view}:${activeTab ?? ''}`}>
      {!workspace ? <section className="welcome-screen"><div className="welcome-visual"><img src={serenityIcon} alt=""/><span className="visual-orbit orbit-one"/><span className="visual-orbit orbit-two"/><span className="visual-dot dot-one"/><span className="visual-dot dot-two"/><span className="visual-dot dot-three"/></div><div className="welcome-copy"><span className="eyebrow">A SPACE FOR EVERYTHING THAT MATTERS</span><h1>Your world,<br/><em>more connected.</em></h1><p>A private workspace for your knowledge, relationships, plans, and the ideas in between. Choose a folder on your device to begin.</p><button className="primary welcome-action" onClick={() => void chooseWorkspace()}><FolderOpen size={18}/> Choose a workspace <ArrowRight size={17}/></button><small>Your files stay in a folder you control.</small></div></section>
          : builtinViews.render(view, { workspace, page: currentPage ?? undefined, commands,
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
        <button onClick={() => { setRightOpen(false); setAIExpanded(false) }} aria-label="Collapse AI sidebar" aria-keyshortcuts={ariaShortcut('assistant.toggle')} title={withShortcut('Collapse AI sidebar', 'assistant.toggle')}><PanelRightClose size={17}/></button>
      </div></div>
      <ConversationList workspace={workspace} conversationId={conversationId} autonomy={autonomy} permissions={permissions} readScope={readScope} busy={busy}
        onNew={() => runCommand('assistant.new')} onSelect={selectConversation} onPermissionsChange={setPermissions} onReadScopeChange={setReadScope} onSaveSettings={() => void saveWorkflowSettings()} />
      {readScope.mode === 'selected' && <div className="ai-scope-note" role="status">Selected knowledge only · review allowed files in Workflow settings</div>}
      <ConversationPanel conversation={conversation} provider={provider} onProviderChange={setProvider} autonomy={autonomy} onAutonomyChange={setAutonomy} retained={retained} onRetentionChange={setRetained} message={message} onMessageChange={setMessage} busy={busy} onSend={(event) => void sendMessage(event)} onCancel={() => void cancelMessage()} onDelete={() => void deleteConversation()} activeFile={activeFile} openFileCount={tabs.length} />
    </aside> : <aside className="assistant-rail" aria-label="AI assistant collapsed"><button onClick={() => setRightOpen(true)} title="Expand AI sidebar" aria-label="Expand AI sidebar"><PanelRightOpen size={20}/></button><span>AI</span></aside>)}
    </div>
    <CommandPalette open={paletteOpen && Boolean(workspace)} query={query} results={results} searching={searching} provider={provider} savedIndexEnabled={Boolean(workspace?.modules.semanticIndex)} commands={commands.filter((command) => !command.hideInPalette)} shortcutFor={shortcut} onChange={(value) => void searchText(value)} onClose={closePalette} onSelect={openSearchResult} onAISearch={() => void searchSemantically()} onSavedSearch={() => void searchSavedConcepts()} onCommand={runCommand} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
