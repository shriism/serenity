import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, Columns2, FileText, FolderOpen, Maximize2, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, RotateCw, Search, Sparkles, X } from 'lucide-react'
import type { Autonomy, Conversation, Provider, ReadScope, SearchResult, WorkflowPermissions, WorkspacePage, WorkspaceSnapshot } from '../../shared/types'
import { ConversationPanel } from './conversation-panel'
import { ConversationList } from './conversation-list'
import { defaultReadScope, defaultWorkflowPermissions } from '../../shared/workflow'
import { AppNavigation } from './navigation'
import { builtinViews, type BuiltinViewContext } from './builtin-views'
import { CommandPalette } from './command-palette'
import { ThemeControl, useTheme } from './theme'
import type { View } from './views'
import { WorkspaceTabs } from './workspace-tabs'
import { routeResource, tabKey, tabPath, tabTitle, type TabRef } from './resource-routing'
import { presentationFor } from './presentations'
import { activeTabOf, closeGroup, emptyGroup, enterView, presentTab, findGroup, focusedGroup, initialWorkbench, nextGroupId, orderedGroups, pruneWorkbench, removeTab, restoreWorkbench, showTab, showView, shownUri, splitWorkbench, updateGroup, workbenchSession, type EditorGroup, type Workbench } from './workbench-groups'
import { layoutGroupIds, maxEditorGroups, type LayoutNode } from '../../shared/layout'
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
  const [workspace, setWorkspaceState] = useState<WorkspaceSnapshot | null>(null)
  // Refreshes and operations can finish out of order; never replace a snapshot with one whose reading began earlier.
  // The newest generation is also recorded immediately, so effects still holding an older snapshot can tell.
  const newestSnapshot = useRef<{ path: string; generation: number } | null>(null)
  const isNewest = (snapshot: WorkspaceSnapshot): boolean =>
    !newestSnapshot.current || newestSnapshot.current.path !== snapshot.path || snapshot.generation >= newestSnapshot.current.generation
  const setWorkspace = useCallback((next: WorkspaceSnapshot | null) => {
    if (next && isNewest(next)) newestSnapshot.current = { path: next.path, generation: next.generation }
    setWorkspaceState((current) => !next || !current || next.path !== current.path || next.generation >= current.generation ? next : current)
  }, [])
  const [workbench, setWorkbench] = useState<Workbench>(initialWorkbench)
  // Groups whose page or entity editor has unsaved edits. Each editor owns its draft; the shell only guards leaving it.
  const [dirtyGroups, setDirtyGroups] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [leftOpen, setLeftOpen] = useState(() => storedPanel('serenity.left-open', false))
  const [rightOpen, setRightOpen] = useState(() => storedPanel('serenity.right-open', true))
  const [aiExpanded, setAIExpanded] = useState(false)
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
  const dirtyHandlers = useRef(new Map<string, (dirty: boolean) => void>())
  const focused = focusedGroup(workbench)
  const view = focused.view
  const activeTabRef = activeTabOf(focused)
  const activePageId = view === 'home' && activeTabRef?.kind === 'page' ? activeTabRef.id : null
  const viewAvailable = (target: View): boolean => Boolean(workspace && builtinViews.available(target, { workspace }))
  const anyDirty = Object.values(dirtyGroups).some(Boolean)
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
    } catch (cause) {
      setError(String(cause))
    }
  }, [])

  useEffect(() => window.serenity.onWorkspaceChange(() => { void refresh() }), [refresh])
  useEffect(() => { void window.serenity.refresh().then(setWorkspace).catch((cause) => setError(String(cause))) }, [])
  useEffect(() => window.serenity.setEditorDirty(anyDirty), [anyDirty])
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
      setWorkbench(restoreWorkbench(session, workspace, (id) => builtinViews.available(id, { workspace })))
      setDirtyGroups({})
      setSessionReadyPath(workspace.path)
    }).catch((error) => { if (current) setError(`Workspace session: ${String(error)}`) })
    return () => { current = false }
  }, [workspace?.path])
  useEffect(() => {
    if (!workspace || sessionReadyPath !== workspace.path) return
    const session = workbenchSession(workbench, workspace.workbench.homePage, conversationId ? resourceUri({ kind: 'conversation', id: conversationId }) : undefined)
    const timer = window.setTimeout(() => { void window.serenity.saveSession(session).catch((error) => setError(`Workspace session: ${String(error)}`)) }, 180)
    return () => window.clearTimeout(timer)
  }, [workspace?.path, workspace?.workbench.homePage, sessionReadyPath, workbench, conversationId])
  useEffect(() => {
    // An effect from an earlier render can run after a newer snapshot has arrived and a tab was opened from it;
    // pruning with the older snapshot would close that tab as if its resource were gone.
    if (workspace) setWorkbench((current) => isNewest(workspace) ? pruneWorkbench(current, workspace, (id) => builtinViews.available(id, { workspace })) : current)
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
      setWorkbench(initialWorkbench)
      setDirtyGroups({})
      setError('')
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

  /** A stable per-group callback, so editors' dirty-tracking effects do not re-run on every render. */
  function dirtyHandler(groupId: string): (dirty: boolean) => void {
    let handler = dirtyHandlers.current.get(groupId)
    if (!handler) {
      handler = (dirty) => setDirtyGroups((current) => Boolean(current[groupId]) === dirty ? current : { ...current, [groupId]: dirty })
      dirtyHandlers.current.set(groupId, handler)
    }
    return handler
  }

  function confirmLeave(groupId: string): boolean {
    if (!dirtyGroups[groupId]) return true
    if (!window.confirm('Discard your unsaved changes?')) return false
    setDirtyGroups((current) => ({ ...current, [groupId]: false }))
    return true
  }

  /** A group that `sideGroup` may have just created is not in this render's state yet; treat it as empty. */
  function groupState(groupId: string): EditorGroup {
    return findGroup(workbench, groupId) ?? emptyGroup(groupId)
  }

  /** Changes what a group shows and focuses it. */
  function show(groupId: string, update: (group: EditorGroup) => EditorGroup): void {
    setWorkbench((current) => findGroup(current, groupId) ? { ...updateGroup(current, groupId, update), focused: groupId } : current)
  }

  function focusGroup(groupId: string): void {
    setWorkbench((current) => current.focused === groupId || !findGroup(current, groupId) ? current : { ...current, focused: groupId })
  }

  /** The group beside `from`, creating an empty one if there is room. Returns `from` at the group limit. */
  function sideGroup(from: string = workbench.focused): string {
    const other = nextGroupId(workbench, from)
    if (other) return other
    const planned = splitWorkbench(workbench, { from, duplicate: false })
    if (!planned) return from
    // Apply on top of any update queued earlier in this event, e.g. opening a resource in `from` just before.
    setWorkbench((current) => findGroup(current, planned.focused) ? current : splitWorkbench(current, { from, duplicate: false }) ?? current)
    return planned.focused
  }

  function openEntity(id: string, groupId: string = workbench.focused): boolean {
    const tab: TabRef = { kind: 'entity', id }
    const group = groupState(groupId)
    if (group.view === 'knowledge' && group.activeTab === tabKey(tab)) { focusGroup(groupId); return true }
    if (!workspace?.entities.some((item) => item.id === id) || !confirmLeave(groupId)) return false
    setError('')
    show(groupId, (current) => showTab(current, tab))
    return true
  }

  function newEntity(groupId: string = workbench.focused) {
    if (!confirmLeave(groupId)) return
    setError('')
    show(groupId, (current) => ({ ...showView(current, 'knowledge'), creatingEntity: true }))
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

  function openSearchResult(result: SearchResult, side: boolean) {
    // The search index records claim hits under their subject entity's ID.
    const kind = result.kind === 'claim' && !workspace?.claims.some((item) => item.id === result.id) ? 'entity' : result.kind
    if (openResource(resourceUri({ kind, id: result.id }), { side })) closePalette()
  }

  /** Opens a resource in a group: the given one, the focused one, or with `side` the group beside it. */
  function openResource(uri: string, options: { group?: string; side?: boolean } = {}): boolean {
    const target = workspace ? routeResource(workspace, uri, viewAvailable) : null
    if (!workspace || !target) return false
    if (target.action === 'external') { void openDocument(target.name); return true }
    if (target.action === 'conversation') {
      const conversation = workspace.conversations.find((item) => item.id === target.id)
      if (conversation) selectConversation(conversation)
      return Boolean(conversation)
    }
    const groupId = options.side ? sideGroup(options.group) : options.group ?? workbench.focused
    switch (target.action) {
      case 'tab': return openTabRef(target.tab, groupId)
      case 'home': return navigate('home', groupId)
      case 'focus': return focusRecord(target.kind, target.id, groupId)
      case 'view': return navigate(target.view, groupId)
    }
  }

  function openTabRef(tab: TabRef, groupId: string): boolean {
    if (tab.kind === 'document') return openDocumentTab(tab.id, groupId)
    if (tab.kind === 'page') return openPageTab(tab.id, groupId)
    return openEntity(tab.id, groupId)
  }

  function openPageTab(id: string, groupId: string): boolean {
    const tab: TabRef = { kind: 'page', id }
    const group = groupState(groupId)
    if (!(group.view === 'home' && group.activeTab === tabKey(tab)) && !confirmLeave(groupId)) return false
    show(groupId, (current) => showTab(current, tab))
    return true
  }

  function focusRecord(kind: 'task' | 'event', id: string, groupId: string): boolean {
    if (!confirmLeave(groupId)) return false
    if (kind === 'task') setFocusedTaskId(id)
    else setFocusedEventId(id)
    setFocusVersion((version) => version + 1)
    show(groupId, (current) => showView(current, kind === 'task' ? 'tasks' : 'calendar'))
    return true
  }

  function navigate(destination: View, groupId: string = workbench.focused): boolean {
    const group = groupState(groupId)
    if (!viewAvailable(destination)) return false
    if ((group.view !== destination || group.activeTab || group.creatingEntity) && !confirmLeave(groupId)) return false
    if (destination === 'calendar') setFocusedEventId(null)
    if (destination === 'tasks') setFocusedTaskId(null)
    show(groupId, (current) => enterView(current, destination))
    if (leftOpen) setLeftOpen(false)
    if (destination === 'activity') void refresh()
    return true
  }

  function runCommand(id: string): void {
    commands.find((item) => item.id === id)?.run(commandHost)
  }

  async function createPage(groupId: string = workbench.focused): Promise<void> {
    if (!confirmLeave(groupId)) return
    try {
      const before = new Set(workspace?.pages.map((page) => page.id) ?? [])
      const next = await window.serenity.createPage()
      const created = next.pages.find((page) => !before.has(page.id))
      if (!created) throw new Error('New page was not found in this workspace')
      setWorkspace(next)
      show(groupId, (current) => showTab(current, { kind: 'page', id: created.id }))
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

  function openDocumentTab(name: string, groupId: string = workbench.focused): boolean {
    const item = workspace?.documents.find((document) => document.name === name)
    if (!item) return false
    if (!item.extractable) { void openDocument(name); return true }
    const tab: TabRef = { kind: 'document', id: name }
    const group = groupState(groupId)
    if (!(group.view === 'documents' && group.activeTab === tabKey(tab)) && !confirmLeave(groupId)) return false
    show(groupId, (current) => showTab(current, tab))
    return true
  }

  function activateTab(key: string, groupId: string) {
    const tab = groupState(groupId).tabs.find((item) => tabKey(item) === key)
    if (tab) openTabRef(tab, groupId)
  }

  function closeTab(key: string, groupId: string) {
    if (groupState(groupId).activeTab === key && !confirmLeave(groupId)) return
    setWorkbench((current) => updateGroup(current, groupId, (group) => removeTab(group, key)))
  }

  function changePresentation(groupId: string, tab: TabRef, presentation: string): void {
    // Leaving the default presentation replaces its editor, so unsaved edits there need the usual confirmation.
    if (!confirmLeave(groupId)) return
    const fallback = presentationFor(tab.kind, undefined)
    setWorkbench((current) => updateGroup(current, groupId, (group) => presentTab(group, tabKey(tab), presentation === fallback ? undefined : presentation)))
  }

  function splitEditor(): void {
    const next = splitWorkbench(workbench)
    if (next) setWorkbench(next)
  }

  function closeEditorGroup(groupId: string = workbench.focused): void {
    if (workbench.groups.length < 2 || !confirmLeave(groupId)) return
    setWorkbench((current) => closeGroup(current, groupId))
    setDirtyGroups(({ [groupId]: _closed, ...rest }) => rest)
  }

  function focusNextGroup(): void {
    const next = nextGroupId(workbench)
    if (!next) return
    focusGroup(next)
    document.querySelector<HTMLElement>(`[data-group="${next}"]`)?.focus()
  }

  function moveTabToOtherGroup(): void {
    const tab = activeTabOf(focused)
    if (!tab || !confirmLeave(focused.id)) return
    const target = sideGroup(focused.id)
    if (target === focused.id) return
    setWorkbench((current) => ({ ...updateGroup(updateGroup(current, focused.id, (group) => removeTab(group, tabKey(tab))), target, (group) => showTab(group, tab)), focused: target }))
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!message.trim() || busy || !workspace) return
    if (autonomy === 'ask' && !window.confirm(`Allow ${provider} to read this workspace for this request? No knowledge changes will be saved without separate approval.`)) return
    setBusy(true)
    try {
      const groups = orderedGroups(workbench)
      const shownRef = (group: EditorGroup): string | undefined => {
        const ref = parseResourceUri(shownUri(group, workspace.workbench.homePage) ?? '')
        return ref ? `${ref.kind}:${ref.id}` : undefined
      }
      const next = await window.serenity.sendMessage({ conversationId: conversationId ?? undefined, text: message, provider, autonomy, retained, permissions, readScope,
        activeRef: shownRef(focused), visibleRefs: groups.filter((group) => group.id !== focused.id).flatMap((group) => shownRef(group) ?? []),
        openRefs: [...new Set(groups.flatMap((group) => group.tabs.map(tabKey)))] })
      if (!conversationId) {
        const created = next.conversations.find((item) => !workspace.conversations.some((old) => old.id === item.id))
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

  const commands = workspace ? workspaceCommands(workspace) : []
  const keymap = resolveKeymap(commands, workspace?.workbench.keybindings, workspace ? knownCommandIds(workspace) : undefined)
  const mac = navigator.platform.includes('Mac')
  const shortcut = (id: string): string | undefined => { const binding = keymap.byCommand.get(id); return binding && formatKeybinding(binding, mac) }
  const ariaShortcut = (id: string): string | undefined => keymap.byCommand.get(id)?.replace('Mod', mac ? 'Meta' : 'Control').replace('Ctrl', 'Control')
  const withShortcut = (label: string, id: string): string => { const keys = shortcut(id); return keys ? `${label} (${keys})` : label }
  const commandHost: CommandHost = {
    navigate: (destination) => navigate(destination),
    openResource: (uri) => { const opened = openResource(uri); if (opened && leftOpen) setLeftOpen(false); return opened },
    newEntity: () => newEntity(),
    createPage: () => { void createPage() },
    importDocuments: () => { if (navigate('documents')) void importDocuments() },
    newConversation: () => startConversation(),
    toggleSearch: () => { if (paletteOpen) closePalette(); else setPaletteOpen(true) },
    toggleNavigation: () => setLeftOpen((open) => !open),
    toggleAssistant: () => { setRightOpen((open) => !open); setAIExpanded(false) },
    splitEditor,
    closeEditorGroup: () => closeEditorGroup(),
    focusNextGroup,
    moveTabToOtherGroup,
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
  const multipleGroups = workbench.groups.length > 1
  const canSplit = workbench.groups.length < maxEditorGroups
  const pageFor = (group: EditorGroup): WorkspacePage | undefined => {
    const tab = activeTabOf(group)
    return workspace && group.view === 'home' ? workspace.pages.find((item) => item.id === (tab?.kind === 'page' ? tab.id : workspace.workbench.homePage)) : undefined
  }
  const groupTitle = (group: EditorGroup): string => {
    const tab = activeTabOf(group)
    return !workspace ? 'Welcome' : group.view === 'home' ? pageFor(group)?.title ?? 'Home' : tab ? tabTitle(workspace, tab) : title[group.view]
  }
  const currentTab = activeTabRef
  const currentPage = pageFor(focused)
  const activeFile = currentTab && currentTab.kind !== 'page' && workspace ? {
    name: tabTitle(workspace, currentTab),
    path: tabPath(workspace, currentTab),
    kind: currentTab.kind,
    allowed: readScope.mode === 'workspace' || (currentTab.kind === 'entity' ? readScope.entityIds.includes(currentTab.id) : readScope.documentNames.includes(currentTab.id))
  } : currentPage ? { name: currentPage.title, path: currentPage.path, kind: 'page' as const, allowed: readScope.mode === 'workspace' } : undefined
  const openFileCount = new Set(workbench.groups.flatMap((group) => group.tabs.map(tabKey))).size

  function viewContext(group: EditorGroup, snapshot: WorkspaceSnapshot): BuiltinViewContext {
    const tab = activeTabOf(group)
    return { workspace: snapshot, page: pageFor(group), commands,
      activeDocument: tab?.kind === 'document' ? tab.id : undefined, focusedEventId, focusedTaskId, focusVersion, activity,
      onUpdate: setWorkspace, onError: setError, onDirtyChange: dirtyHandler(group.id),
      onOpenResource: (uri, side) => { openResource(uri, { group: group.id, side }) }, onCommand: runCommand,
      onResolve: (id, accept) => { void resolveProposal(id, accept) }, onAttach: (id, entityId) => { void attachProposal(id, entityId) },
      onOpenSource: (name) => { void openDocument(name) }, onImport: () => { void importDocuments() }, onOpenDocument: (name) => { openDocumentTab(name, group.id) },
      onAnalyze: (name) => { openDocumentTab(name, group.id); startConversation(`Analyze the imported document ${name}. Summarize it, identify useful knowledge about existing entities, and suggest claims with precise sources. Ask me to clarify any ambiguous identities.`) },
      entityId: tab?.kind === 'entity' ? tab.id : undefined, creatingEntity: group.creatingEntity,
      presentation: tab ? group.presentations[tabKey(tab)] : undefined,
      onPresentationChange: (id) => { if (tab) changePresentation(group.id, tab, id) },
      onOpenEntity: (id) => { openEntity(id, group.id) }, onNewEntity: () => newEntity(group.id), onDiscuss: startConversation,
      onEntityCreated: (id) => setWorkbench((current) => updateGroup(current, group.id, (item) => showTab(item, { kind: 'entity', id })))
    }
  }

  function renderGroup(group: EditorGroup, snapshot: WorkspaceSnapshot, position: number): ReactNode {
    const isFocused = group.id === workbench.focused
    return <section key={group.id} data-group={group.id} tabIndex={-1} className={`editor-group ${isFocused ? 'focused' : ''}`}
      aria-label={multipleGroups ? `${groupTitle(group)} · editor group ${position}` : undefined} aria-current={multipleGroups && isFocused ? 'true' : undefined}
      onMouseDownCapture={() => focusGroup(group.id)} onFocusCapture={() => focusGroup(group.id)}>
      {(group.tabs.length > 0 || multipleGroups) && <div className="group-bar">
        <WorkspaceTabs tabs={group.tabs.map((tab) => ({ key: tabKey(tab), kind: tab.kind, title: tabTitle(snapshot, tab) }))} active={group.activeTab}
          onSelect={(key) => activateTab(key, group.id)} onClose={(key) => closeTab(key, group.id)}/>
        {multipleGroups && <div className="group-actions">
          {!group.tabs.length && <span className="group-title">{groupTitle(group)}</span>}
          <button onClick={() => closeEditorGroup(group.id)} aria-label={`Close editor group ${position}`} title="Close editor group"><X size={14}/></button>
        </div>}
      </div>}
      {group.view === 'review' && snapshot.proposals.some((item) => item.status === 'pending' && item.reviewReason) && <div className="notice warning" role="status">Some proposals involve similar entities. Verify the identity before accepting them.</div>}
      <div className="workspace-body" key={`${group.view}:${group.activeTab ?? ''}:${group.creatingEntity}`}>
        {builtinViews.render(group.view, viewContext(group, snapshot)) ?? <section className="page"><h1>View unavailable</h1><p>This module is not available in this workspace.</p></section>}
      </div>
    </section>
  }

  function renderLayout(node: LayoutNode, snapshot: WorkspaceSnapshot): ReactNode {
    if ('group' in node) {
      const group = findGroup(workbench, node.group)
      return group ? renderGroup(group, snapshot, layoutGroupIds(workbench.root).indexOf(group.id) + 1) : null
    }
    return <div className={`editor-split ${node.split}`} key={layoutGroupIds(node).join('+')}>{node.children.map((child) => renderLayout(child, snapshot))}</div>
  }

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
        <div className="breadcrumbs"><strong>{groupTitle(focused)}</strong></div>
        {workspace && <div className="topbar-actions">
          <button className="topbar-search" onClick={() => runCommand('workspace.search')} title={withShortcut('Search workspace', 'workspace.search')} aria-label="Search workspace"><Search size={18}/></button>
          {canSplit && <button className="topbar-icon" onClick={() => runCommand('layout.split')} title={withShortcut('Split editor', 'layout.split')} aria-label="Split editor" aria-keyshortcuts={ariaShortcut('layout.split')}><Columns2 size={18}/></button>}
          {!rightOpen && <button className="topbar-icon show-ai" onClick={() => setRightOpen(true)} title={withShortcut('Show AI assistant', 'assistant.toggle')} aria-label="Show AI sidebar" aria-keyshortcuts={ariaShortcut('assistant.toggle')}><PanelRightOpen size={18}/></button>}
          <details className="topbar-more"><summary aria-label="Workspace actions" title="Workspace actions"><MoreHorizontal size={19}/></summary><div className="topbar-menu"><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('entity.create') }}><Plus size={15}/> New entity</button><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('page.create') }}><FileText size={15}/> New page</button><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); runCommand('workspace.refresh') }}><RotateCw size={15}/> Refresh files</button></div></details>
        </div>}
      </header>
      {error && <div className="notice error" role="alert">{error}</div>}
      {workspace?.errors.map((item) => <div key={item} className="notice warning" role="alert">Could not read {item}</div>)}
      {keymap.problems.map((item) => <div key={item} className="notice warning" role="alert">.serenity/workbench.yaml: {item}</div>)}
      {!workspace ? <div className="workspace-body"><section className="welcome-screen"><div className="welcome-visual"><img src={serenityIcon} alt=""/><span className="visual-orbit orbit-one"/><span className="visual-orbit orbit-two"/><span className="visual-dot dot-one"/><span className="visual-dot dot-two"/><span className="visual-dot dot-three"/></div><div className="welcome-copy"><span className="eyebrow">A SPACE FOR EVERYTHING THAT MATTERS</span><h1>Your world,<br/><em>more connected.</em></h1><p>A private workspace for your knowledge, relationships, plans, and the ideas in between. Choose a folder on your device to begin.</p><button className="primary welcome-action" onClick={() => void chooseWorkspace()}><FolderOpen size={18}/> Choose a workspace <ArrowRight size={17}/></button><small>Your files stay in a folder you control.</small></div></section></div>
        : <div className={`editor-groups ${multipleGroups ? 'split' : ''}`}>{renderLayout(workbench.root, workspace)}</div>}
    </main>
    {workspace && (rightOpen ? <aside className="assistant-sidebar" aria-label="AI assistant">
      <div className="assistant-toolbar"><div><Sparkles size={18}/><span>Assistant</span><small>WITH YOUR WORKSPACE</small></div><div className="assistant-toolbar-actions">
        <button onClick={() => setAIExpanded(!aiExpanded)} aria-label={aiExpanded ? 'Return AI to sidebar' : 'Expand AI over workspace'} title={aiExpanded ? 'Return AI to sidebar' : 'Expand AI over workspace'}>{aiExpanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
        <button onClick={() => { setRightOpen(false); setAIExpanded(false) }} aria-label="Collapse AI sidebar" aria-keyshortcuts={ariaShortcut('assistant.toggle')} title={withShortcut('Collapse AI sidebar', 'assistant.toggle')}><PanelRightClose size={17}/></button>
      </div></div>
      <ConversationList workspace={workspace} conversationId={conversationId} autonomy={autonomy} permissions={permissions} readScope={readScope} busy={busy}
        onNew={() => runCommand('assistant.new')} onSelect={selectConversation} onPermissionsChange={setPermissions} onReadScopeChange={setReadScope} onSaveSettings={() => void saveWorkflowSettings()} />
      {readScope.mode === 'selected' && <div className="ai-scope-note" role="status">Selected knowledge only · review allowed files in Workflow settings</div>}
      <ConversationPanel conversation={conversation} provider={provider} onProviderChange={setProvider} autonomy={autonomy} onAutonomyChange={setAutonomy} retained={retained} onRetentionChange={setRetained} message={message} onMessageChange={setMessage} busy={busy} onSend={(event) => void sendMessage(event)} onCancel={() => void cancelMessage()} onDelete={() => void deleteConversation()} activeFile={activeFile} openFileCount={openFileCount} onOpenResource={(uri, side) => { openResource(uri, { side }) }} />
    </aside> : <aside className="assistant-rail" aria-label="AI assistant collapsed"><button onClick={() => setRightOpen(true)} title="Expand AI sidebar" aria-label="Expand AI sidebar"><PanelRightOpen size={20}/></button><span>AI</span></aside>)}
    </div>
    <CommandPalette open={paletteOpen && Boolean(workspace)} query={query} results={results} searching={searching} provider={provider} savedIndexEnabled={Boolean(workspace?.modules.semanticIndex)} commands={commands.filter((command) => !command.hideInPalette)} shortcutFor={shortcut} onChange={(value) => void searchText(value)} onClose={closePalette} onSelect={openSearchResult} onAISearch={() => void searchSemantically()} onSavedSearch={() => void searchSavedConcepts()} onCommand={runCommand} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
