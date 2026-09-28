import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, Archive, ChevronDown, Columns2, FolderOpen, History, Maximize2, MessageSquarePlus, MoreHorizontal, MoveRight, PanelLeft, PanelRight, RotateCw, Settings2, Trash2, X } from 'lucide-react'
import type { Conversation, SearchResult, WorkspaceSnapshot } from '../../shared/types'
import { useAssistant } from './use-assistant'
import { ErrorBoundary } from './error-boundary'
import { workspaceActivity } from '../../shared/activity'
import { scopeFromResults } from '../../shared/result-scope'
import { documentAnalysisPrompt } from '../../shared/analysis-prompt'
import { builtinViews, type BuiltinViewContext } from './builtin-views'
import { CommandPalette } from './command-palette'
import { useTheme } from './theme'
import { preferences, usePreferences } from './preferences'
import type { View } from './views'
import { isResourceTab, routeResource, tabKey, tabPath, tabTitle, tabViewOf, viewTab, type TabRef } from './resource-routing'
import { PresentationSwitcher, presentationFor, presentations } from './presentations'
import { activeTabOf, closeGroup, emptyGroup, findGroup, focusedGroup, homeWorkbench, initialWorkbench, moveTab, nextGroupId, orderedGroups, presentTab, presentView,
  pruneWorkbench, removeTab, restoreWorkbench, showTab, showView, shownUri, splitWorkbench, updateGroup, workbenchSession, type EditorGroup, type Workbench } from './workbench-groups'
import { layoutGeometry, maxEditorGroups, neighborGroup, resizeSplit, type PaneDirection, type SplitDirection } from '../../shared/layout'
import { PaneDivider, dropZoneAt, percentRect, tabDragType, type DropZone } from './pane-layout'
import { CommandRegistry, type CommandHost } from './commands'
import { eventKeybinding, formatKeybinding, resolveKeymap, type KeymapResult } from '../../shared/keybindings'
import { parseResourceUri, resourceUri } from '../../shared/resources'
import { Explorer } from './explorer'
import { PaneHeader } from './pane-header'
import { MenuButton } from './menu'
import { Dialog } from './dialog'
import { SettingsDialog } from './settings-panel'
import { NewEntityDialog, NewTabScreen, Ribbon, Welcome, type RecentWorkspace } from './shell-parts'
import { Composer, ContextChips, ConversationList, ConversationSettings, ConversationSuggestions, ConversationView, conversationMenu, type ActiveContext, type AssistantState } from './assistant'
import type { EditorContext } from './markdown-editor'
import './app.css'

type Mode = 'workspace' | 'chat'
const platform = navigator.platform.includes('Mac') ? 'mac' : navigator.platform.includes('Win') ? 'windows' : 'linux'

function stored<T extends string | number | boolean>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    return (typeof fallback === 'boolean' ? value === 'true' : typeof fallback === 'number' ? Number(value) || fallback : value) as T
  } catch { return fallback }
}
function useStored<T extends string | number | boolean>(key: string, fallback: T): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => stored(key, fallback))
  useEffect(() => { try { localStorage.setItem(key, String(value)) } catch { /* Still works for this session. */ } }, [key, value])
  return [value, setValue]
}

/** A handle on a sidebar's inner edge that resizes it. */
function SidebarResizer({ side, width, min, max, onResize }: { side: 'left' | 'right'; width: number; min: number; max: number; onResize(width: number): void }) {
  const start = useRef<{ x: number; width: number } | null>(null)
  return <div className={`sidebar-resizer ${side}`} role="separator" aria-orientation="vertical" aria-label={`Resize ${side} sidebar`} tabIndex={0}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); start.current = { x: event.clientX, width }; document.body.classList.add('resizing') }}
    onPointerMove={(event) => { if (!start.current) return; const delta = (event.clientX - start.current.x) * (side === 'left' ? 1 : -1); onResize(Math.min(max, Math.max(min, start.current.width + delta))) }}
    onPointerUp={() => { start.current = null; document.body.classList.remove('resizing') }}
    // A drag should not leave the handle focused, or the next key press would light up its focus ring.
    onMouseDown={(event) => event.preventDefault()}
    onKeyDown={(event) => { const step = event.shiftKey ? 40 : 12; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const grow = (event.key === 'ArrowRight') === (side === 'left'); onResize(Math.min(max, Math.max(min, width + (grow ? step : -step)))) } }}/>
}

/** Where a resource lives, in words: e.g. Knowledge › person › Alex. */
function breadcrumb(snapshot: WorkspaceSnapshot, tab: TabRef): string[] {
  const title = tabTitle(snapshot, tab)
  if (tab.kind === 'entity') return ['Knowledge', snapshot.entities.find((entity) => entity.id === tab.id)?.type || 'Untyped', title]
  return [tab.kind === 'page' ? 'Pages' : 'Documents', title]
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
  const [errors, setErrors] = useState<{ id: number; text: string }[]>([])
  const [mode, setModeState] = useStored<Mode>('serenity.mode', 'workspace')
  // Mode changes swap the layout in one step (no column slide) and fade the new content in.
  const [switchingMode, setSwitchingMode] = useState(false)
  const setMode = useCallback((next: Mode | ((current: Mode) => Mode)) => {
    setSwitchingMode(true)
    setModeState(next)
    window.setTimeout(() => setSwitchingMode(false), 260)
  }, [])
  const [leftOpen, setLeftOpen] = useStored<boolean>('serenity.left-open', true)
  const [rightOpen, setRightOpen] = useStored<boolean>('serenity.right-open', true)
  const [leftWidth, setLeftWidth] = useStored<number>('serenity.left-width', 260)
  const [rightWidth, setRightWidth] = useStored<number>('serenity.right-width', 360)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const [sessionReadyPath, setSessionReadyPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newEntityOpen, setNewEntityOpen] = useState(false)
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [recent, setRecent] = useState<RecentWorkspace[] | null>(null)
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [focusVersion, setFocusVersion] = useState(0)
  const [theme, setTheme, resolvedTheme] = useTheme()
  const searchSequence = useRef(0)
  const commandContext = useRef<{ host: CommandHost; registry: CommandRegistry | null; keymap: KeymapResult; escape(): boolean } | null>(null)
  const paneArea = useRef<HTMLDivElement>(null)
  const [paneAreaSize, setPaneAreaSize] = useState({ width: 0, height: 0 })
  const [dropTarget, setDropTarget] = useState<{ group: string; zone: DropZone } | null>(null)
  // A query carried from the search palette into a pane's Search view.
  const [searchSeeds, setSearchSeeds] = useState<Record<string, string>>({})
  const focused = focusedGroup(workbench)
  const viewAvailable = (target: View): boolean => Boolean(workspace && builtinViews.available(target, { workspace }))
  // Narrow windows keep the sidebars from squeezing the panes: they float over them instead.
  const narrow = windowWidth < 1000
  const setError = useCallback((text: string) => {
    if (!text) return
    setErrors((current) => current.some((item) => item.text === text) ? current : [...current.slice(-2), { id: Date.now() + Math.random(), text }])
  }, [])
  const clearErrors = useCallback(() => setErrors([]), [])

  useEffect(() => { window.serenity.setWindowTheme(resolvedTheme) }, [resolvedTheme])
  const prefs = usePreferences()
  // Auto-hiding scrollbars show while an area scrolls, then fade; the choice is a device preference.
  useEffect(() => {
    document.documentElement.dataset.scrollbars = prefs.autoHideScrollbars ? 'auto' : 'always'
    if (!prefs.autoHideScrollbars) return
    const timers = new WeakMap<Element, number>()
    const scrolled = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : document.scrollingElement
      if (!target) return
      target.classList.add('is-scrolling')
      window.clearTimeout(timers.get(target))
      timers.set(target, window.setTimeout(() => target.classList.remove('is-scrolling'), 900))
    }
    document.addEventListener('scroll', scrolled, true)
    return () => document.removeEventListener('scroll', scrolled, true)
  }, [prefs.autoHideScrollbars])
  useEffect(() => {
    const resize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => { if (narrow) { setLeftOpen(false); setRightOpen(false) } }, [narrow])

  const closePalette = useCallback(() => {
    searchSequence.current++
    setPaletteOpen(false)
    setQuery('')
    setResults(null)
  }, [])

  const refresh = useCallback(async () => {
    try { setWorkspace(await window.serenity.refresh()) }
    catch (cause) { setError(String(cause)) }
  }, [])

  const assistant = useAssistant({ workspace, setWorkspace, refresh, setError: (message) => { if (message) setError(message) },
    reveal: () => { if (mode === 'workspace') setRightOpen(true) },
    contextRefs: () => {
      const refOf = (group: EditorGroup): string | undefined => {
        const ref = parseResourceUri(shownUri(group) ?? '')
        return ref ? `${ref.kind}:${ref.id}` : undefined
      }
      const groups = orderedGroups(workbench)
      if (mode === 'chat') return { visibleRefs: [], openRefs: [] }
      return { activeRef: refOf(focused), visibleRefs: stacked ? [] : groups.filter((group) => group.id !== focused.id).flatMap((group) => refOf(group) ?? []),
        openRefs: [...new Set(groups.flatMap((group) => group.tabs.filter(isResourceTab).map(tabKey)))] }
    } })
  const { conversationId, readScope, restoreConversation, selectConversation } = assistant

  useEffect(() => window.serenity.onWorkspaceChange(() => { void refresh() }), [refresh])
  useEffect(() => { void window.serenity.refresh().then(setWorkspace).catch((cause) => setError(String(cause))) }, [])
  // The recent list offers the last workspace on the welcome screen and others in the workspace menu.
  useEffect(() => { void window.serenity.recentWorkspaces().then(setRecent).catch(() => setRecent([])) }, [workspace?.path])
  useEffect(() => window.serenity.onIndexError((message) => setError(`Background AI: ${message}`)), [])
  // Choices from the application menu run the same commands as their shortcuts.
  useEffect(() => window.serenity.onMenuCommand((id) => { const current = commandContext.current; current?.registry?.dispatch(id, current.host) }), [])
  useEffect(() => {
    if (!workspace) return
    let current = true
    setSessionReadyPath(null)
    void window.serenity.loadSession().then((session) => {
      if (!current) return
      if (!session) { restoreConversation(workspace.conversations.at(-1)); setWorkbench(homeWorkbench(workspace)); setSessionReadyPath(workspace.path); return }
      const lastConversation = workspace.conversations.find((item) => session.assistantUri === resourceUri({ kind: 'conversation', id: item.id })) ?? workspace.conversations.at(-1)
      restoreConversation(lastConversation)
      setWorkbench(restoreWorkbench(session, workspace, (id) => builtinViews.available(id, { workspace })))
      setSessionReadyPath(workspace.path)
    }).catch((error) => { if (current) setError(`Workspace session: ${String(error)}`) })
    return () => { current = false }
  }, [workspace?.path])
  useEffect(() => {
    if (!workspace || sessionReadyPath !== workspace.path) return
    const session = workbenchSession(workbench, conversationId ? resourceUri({ kind: 'conversation', id: conversationId }) : undefined)
    const timer = window.setTimeout(() => { void window.serenity.saveSession(session).catch((error) => setError(`Workspace session: ${String(error)}`)) }, 180)
    return () => window.clearTimeout(timer)
  }, [workspace?.path, sessionReadyPath, workbench, conversationId])
  useEffect(() => {
    // An effect from an earlier render can run after a newer snapshot has arrived and a tab was opened from it;
    // pruning with the older snapshot would close that tab as if its resource were gone.
    if (workspace) setWorkbench((current) => isNewest(workspace) ? pruneWorkbench(current, workspace, (id) => builtinViews.available(id, { workspace })) : current)
  }, [workspace])
  useEffect(() => {
    const mac = platform === 'mac'
    const onShortcut = (event: globalThis.KeyboardEvent): void => {
      const current = commandContext.current
      if (!current) return
      if (event.key === 'Escape') { if (current.escape()) event.preventDefault(); return }
      const binding = eventKeybinding(event, mac)
      const id = binding ? current.keymap.bindings.get(binding) : undefined
      const command = id ? current.registry?.get(id) : undefined
      // A key the focused editor already handled, such as Mod+B for bold, is not also a workbench command.
      if (!command || event.repeat || event.defaultPrevented) return
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')
      if (typing && !command.whileTyping) return
      event.preventDefault()
      current.registry?.dispatch(command.id, current.host)
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  useEffect(() => {
    const element = paneArea.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setPaneAreaSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [workspace !== null, mode])

  async function chooseWorkspace(path?: string) {
    try {
      const next = path ? await window.serenity.openRecentWorkspace(path) : await window.serenity.chooseWorkspace()
      if (!next) return
      setWorkspace(next)
      setSessionReadyPath(null)
      setWorkbench(initialWorkbench)
      clearErrors()
      restoreConversation(undefined)
      closePalette()
      setSettingsOpen(false)
      setFocusedEventId(null)
      setFocusedTaskId(null)
    } catch (cause) { setError(String(cause)) }
  }

  /** A group that `sideGroup` may have just created is not in this render's state yet; treat it as empty. */
  function groupState(groupId: string): EditorGroup {
    return findGroup(workbench, groupId) ?? emptyGroup(groupId)
  }

  /** Changes what a group shows and focuses it. */
  function show(groupId: string, update: (group: EditorGroup) => EditorGroup): void {
    setWorkbench((current) => findGroup(current, groupId) ? { ...updateGroup(current, groupId, update), focused: groupId } : current)
    if (mode === 'chat') setMode('workspace')
    if (narrow) setLeftOpen(false)
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

  function openTab(tab: TabRef, groupId: string = workbench.focused): boolean {
    show(groupId, (current) => showTab(current, tab))
    return true
  }

  function openEntity(id: string, groupId: string = workbench.focused): boolean {
    if (!workspace?.entities.some((item) => item.id === id)) return false
    return openTab({ kind: 'entity', id }, groupId)
  }

  async function createEntity(title: string, type: string): Promise<boolean> {
    try {
      const next = await window.serenity.saveEntity({ id: '', title, type, body: '' })
      const created = next.entities.find((entity) => !workspace?.entities.some((existing) => existing.id === entity.id))
      setWorkspace(next)
      if (created) openTab({ kind: 'entity', id: created.id })
      return true
    } catch (cause) { setError(String(cause)); return false }
  }

  async function searchText(value: string) {
    setQuery(value)
    const request = ++searchSequence.current
    if (!value.trim()) { setResults(null); return }
    try {
      const matches = await window.serenity.search(value)
      if (request === searchSequence.current) setResults(matches)
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
    if (target.action === 'tab') return openTab(target.tab, groupId)
    if (target.kind === 'task') setFocusedTaskId(target.id)
    else setFocusedEventId(target.id)
    setFocusVersion((version) => version + 1)
    return openTab(viewTab(target.view), groupId)
  }

  function navigate(destination: View, groupId: string = workbench.focused): boolean {
    if (destination === 'settings') { setSettingsOpen(true); return true }
    if (!workspace || !viewAvailable(destination)) return false
    if (destination === 'home') {
      const home = workspace.workbench.homePage
      return workspace.pages.some((page) => page.id === home) ? openTab({ kind: 'page', id: home }, groupId) : false
    }
    if (destination === 'calendar') setFocusedEventId(null)
    if (destination === 'tasks') setFocusedTaskId(null)
    if (destination === 'activity') void refresh()
    show(groupId, (current) => showView(current, destination))
    return true
  }

  function runCommand(id: string): void {
    commandRegistry?.dispatch(id, commandHost)
  }

  async function createPage(groupId: string = workbench.focused): Promise<void> {
    try {
      const before = new Set(workspace?.pages.map((page) => page.id) ?? [])
      const next = await window.serenity.createPage()
      const created = next.pages.find((page) => !before.has(page.id))
      if (!created) throw new Error('New page was not found in this workspace')
      setWorkspace(next)
      openTab({ kind: 'page', id: created.id }, groupId)
    } catch (error) { setError(String(error)) }
  }

  async function createDocument(groupId: string = workbench.focused): Promise<void> {
    try {
      const { snapshot, name } = await window.serenity.createDocument()
      setWorkspace(snapshot)
      openTab({ kind: 'document', id: name }, groupId)
    } catch (error) { setError(String(error)) }
  }

  async function searchSemantically() {
    if (!query.trim() || searching) return
    setSearching(true)
    const request = ++searchSequence.current
    try {
      const [lexical, semantic] = await Promise.all([window.serenity.search(query), window.serenity.semanticSearch(query, assistant.provider)])
      if (request === searchSequence.current) setResults([...semantic, ...lexical.filter((entry) => !semantic.some((match) =>
        match.kind === entry.kind && match.id === entry.id && match.title === entry.title))])
      await refresh()
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
    } catch (cause) { setError(String(cause)) }
  }

  async function importDocuments() {
    try { const next = await window.serenity.importDocuments(); if (next) setWorkspace(next) }
    catch (cause) { setError(String(cause)) }
  }

  async function openDocument(name: string) {
    try { await window.serenity.openDocument(name) }
    catch (cause) { setError(String(cause)) }
  }

  function openDocumentTab(name: string, groupId: string = workbench.focused): boolean {
    const item = workspace?.documents.find((document) => document.name === name)
    if (!item) return false
    if (!item.extractable) { void openDocument(name); return true }
    return openTab({ kind: 'document', id: name }, groupId)
  }

  /** Moves a page, entity, or document to the workspace archive after asking; nothing is deleted. */
  async function archiveResource(uri: string): Promise<void> {
    const ref = parseResourceUri(uri)
    if (!workspace || !ref) return
    try {
      if (ref.kind === 'page') {
        const page = workspace.pages.find((item) => item.id === ref.id)
        if (!page || !window.confirm(`Move “${page.title}” to the archive?\n\nIts file moves to archive/pages, where you can still open it or move it back.`)) return
        setWorkspace(await window.serenity.archivePage(page.id, page.revision))
      } else if (ref.kind === 'entity') {
        const entity = workspace.entities.find((item) => item.id === ref.id)
        const facts = workspace.claims.filter((claim) => claim.subject === ref.id).length
        if (!entity?.revision || !window.confirm(`Move “${entity.title}” to the archive?\n\nIts file${facts ? ` and ${facts} ${facts === 1 ? 'fact' : 'facts'}` : ''} move to archive/removed. Other notes that mention it keep its name.`)) return
        setWorkspace(await window.serenity.archiveEntity(entity.id, entity.revision))
      } else if (ref.kind === 'document') {
        if (!window.confirm(`Move “${ref.id}” to the archive?\n\nThe file moves to archive/documents. Facts that cite it keep their source.`)) return
        setWorkspace(await window.serenity.archiveDocument(ref.id))
      }
    } catch (cause) { setError(String(cause)) }
  }

  function closeTab(key: string, groupId: string): void {
    setWorkbench((current) => updateGroup(current, groupId, (group) => removeTab(group, key)))
  }

  function changePresentation(groupId: string, tab: TabRef, presentation: string): void {
    const fallback = presentationFor(tab.kind, undefined)
    setWorkbench((current) => updateGroup(current, groupId, (group) => presentTab(group, tabKey(tab), presentation === fallback ? undefined : presentation)))
  }

  function splitPane(direction: SplitDirection = 'row', groupId: string = workbench.focused): void {
    const next = splitWorkbench(workbench, { from: groupId, direction })
    if (next) setWorkbench(next)
  }

  function resizePanes(path: number[], sizes: number[]): void {
    setWorkbench((current) => ({ ...current, root: resizeSplit(current.root, path, sizes) }))
  }

  function closeEditorGroup(groupId: string = workbench.focused): void {
    if (workbench.groups.length < 2) return
    const remainingFocus = workbench.focused === groupId ? nextGroupId(workbench, groupId) : workbench.focused
    setWorkbench((current) => closeGroup(current, groupId))
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-group="${remainingFocus}"]`)?.focus())
  }

  function focusPaneElement(id: string | null): void {
    if (!id) return
    focusGroup(id)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-group="${id}"]`)?.focus())
  }

  const focusNextGroup = (step = 1): void => focusPaneElement(nextGroupId(workbench, workbench.focused, step))
  const focusPane = (direction: PaneDirection): void => focusPaneElement(neighborGroup(geometry.groups, workbench.focused, direction))

  function moveTabToOtherGroup(groupId: string = focused.id): void {
    const group = groupState(groupId)
    const tab = activeTabOf(group)
    if (!tab) return
    const target = sideGroup(groupId)
    if (target === groupId) return
    setWorkbench((current) => moveTab(current, groupId, tabKey(tab), target))
  }

  /** A tab dropped on a pane: into it at the center, or into a new pane split off toward the nearest edge. */
  function dropTab(from: string, key: string, to: string, zone: DropZone, before?: string): void {
    const source = findGroup(workbench, from)
    if (!source?.tabs.some((tab) => tabKey(tab) === key)) return
    if (zone === 'center' && from === to) { setWorkbench((current) => moveTab(current, from, key, to, before)); return }
    if (zone === 'center') { setWorkbench((current) => moveTab(current, from, key, to, before)); return }
    const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'row' : 'column'
    setWorkbench((current) => {
      const split = splitWorkbench(current, { from: to, direction, before: zone === 'left' || zone === 'top', duplicate: false })
      return split ? moveTab(split, from, key, split.focused) : current
    })
  }

  async function resolveProposal(id: string, accept: boolean) {
    try { setWorkspace(await window.serenity.resolveProposal(id, accept)) }
    catch (cause) { setError(String(cause)) }
  }

  async function attachProposal(id: string, entityId: string) {
    try { setWorkspace(await window.serenity.attachEntityProposal(id, entityId)) }
    catch (cause) { setError(String(cause)) }
  }

  /** Starts a new conversation where the person is: beside their work, or in Chat mode. */
  function startConversation(prompt = '', scope?: Parameters<typeof assistant.startConversation>[1]): void {
    assistant.startConversation(prompt, scope)
    if (mode === 'workspace') setRightOpen(true)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(mode === 'chat' ? '.chat-main .composer textarea' : '.assistant-panel .composer textarea')?.focus())
  }

  const commandRegistry = useMemo(() => workspace ? new CommandRegistry(workspace) : null, [workspace])
  const commands = useMemo(() => commandRegistry?.list() ?? [], [commandRegistry])
  const keymap = useMemo(() => resolveKeymap(commands, workspace?.workbench.keybindings, commandRegistry?.knownIds()), [commands, workspace, commandRegistry])
  const mac = platform === 'mac'
  const shortcut = (id: string): string | undefined => { const binding = keymap.byCommand.get(id); return binding && formatKeybinding(binding, mac) }
  const ariaShortcut = (id: string): string | undefined => keymap.byCommand.get(id)?.replace('Mod', mac ? 'Meta' : 'Control').replace('Ctrl', 'Control')
  const withShortcut = (label: string, id: string): string => { const keys = shortcut(id); return keys ? `${label} (${keys})` : label }
  const shortcuts = useMemo(() => commands.filter((command) => !command.id.startsWith('page.open.') || keymap.byCommand.has(command.id))
    .map((command) => ({ id: command.id, title: command.title, keys: keymap.byCommand.has(command.id) ? formatKeybinding(keymap.byCommand.get(command.id)!, mac) : undefined })), [commands, keymap, mac])
  const commandHost: CommandHost = {
    navigate: (destination) => navigate(destination),
    openResource: (uri) => openResource(uri),
    newEntity: () => setNewEntityOpen(true),
    createPage: () => { void createPage() },
    importDocuments: () => { void importDocuments() },
    chooseWorkspace: () => { void chooseWorkspace() },
    openWorkspaceFolder: () => { void window.serenity.openWorkspaceFolder().catch((cause) => setError(String(cause))) },
    newConversation: () => startConversation(),
    toggleSearch: () => { if (paletteOpen) closePalette(); else setPaletteOpen(true) },
    toggleNavigation: () => setLeftOpen((open) => !open),
    toggleAssistant: () => { if (mode === 'chat') setMode('workspace'); else setRightOpen((open) => !open) },
    toggleAssistantExpansion: () => setMode((current) => current === 'chat' ? 'workspace' : 'chat'),
    setAppearance: (preference) => setTheme(preference),
    cyclePresentation: () => {
      const tab = activeTabOf(focused)
      const options = tab ? presentations[tab.kind] : undefined
      if (!tab || !options || options.length < 2) return
      const current = presentationFor(tab.kind, focused.presentations[tabKey(tab)])
      changePresentation(focused.id, tab, options[(options.findIndex((option) => option.id === current) + 1) % options.length].id)
    },
    splitEditor: (direction) => splitPane(direction),
    closeEditorGroup: () => closeEditorGroup(),
    focusNextGroup: (step) => focusNextGroup(step),
    focusPane,
    moveTabToOtherGroup: () => moveTabToOtherGroup(),
    newTab: () => { if (mode === 'chat') setMode('workspace'); setWorkbench((current) => updateGroup(current, current.focused, (group) => showView(group, 'home'))) },
    closeTab: () => {
      const tab = activeTabOf(focused)
      if (tab) closeTab(tabKey(tab), focused.id)
      else if (multipleGroups) closeEditorGroup()
    },
    goToTab: (position) => {
      if (!preferences.get().numberedTabShortcuts || mode !== 'workspace' || !focused.tabs.length) return
      const tab = position >= 9 ? focused.tabs.at(-1) : focused.tabs[position - 1]
      if (tab) setWorkbench((current) => updateGroup(current, focused.id, (group) => showTab(group, tab)))
    },
    cycleTab: (step) => {
      if (focused.tabs.length < 2) return
      const index = focused.tabs.findIndex((tab) => tabKey(tab) === focused.activeTab)
      const next = focused.tabs[(index + step + focused.tabs.length) % focused.tabs.length]
      setWorkbench((current) => updateGroup(current, focused.id, (group) => showTab(group, next)))
    },
    refresh: () => { void refresh() }
  }
  commandContext.current = { host: commandHost, registry: commandRegistry, keymap, escape: () => {
    if (paletteOpen) { closePalette(); return true }
    if (narrow && (leftOpen || rightOpen)) { setLeftOpen(false); setRightOpen(false); return true }
    return false
  } }

  const pending = workspace?.proposals.filter((proposal) => proposal.status === 'pending') ?? []
  // The feed spans every record; rebuild it when the workspace changes, not on each keystroke elsewhere in the shell.
  const activity = useMemo(() => workspace ? workspaceActivity(workspace) : [], [workspace])
  const multipleGroups = workbench.groups.length > 1
  const canSplit = workbench.groups.length < maxEditorGroups
  const geometry = useMemo(() => layoutGeometry(workbench.root), [workbench.root])
  // When any pane would be too small to use, show one pane at a time with a switcher. Hidden panes stay mounted.
  const stacked = multipleGroups && paneAreaSize.width > 0 && [...geometry.groups.values()].some((rect) =>
    rect.width * paneAreaSize.width < 260 || rect.height * paneAreaSize.height < 180)
  const pageFor = (group: EditorGroup) => {
    const tab = activeTabOf(group)
    return workspace && tab?.kind === 'page' ? workspace.pages.find((item) => item.id === tab.id) : undefined
  }
  const groupTitle = (group: EditorGroup): string => {
    const tab = activeTabOf(group)
    return !workspace ? 'Serenity' : tab ? tabTitle(workspace, tab) : 'New tab'
  }
  const focusedTab = activeTabOf(focused)
  const activeFile: ActiveContext | undefined = focusedTab && isResourceTab(focusedTab) && workspace ? {
    name: tabTitle(workspace, focusedTab), path: tabPath(workspace, focusedTab), kind: focusedTab.kind,
    allowed: readScope.mode === 'workspace' || (focusedTab.kind === 'entity' ? readScope.entityIds.includes(focusedTab.id) : focusedTab.kind === 'document' && readScope.documentNames.includes(focusedTab.id))
  } : undefined
  const openFileCount = new Set(workbench.groups.flatMap((group) => group.tabs.filter(isResourceTab).map(tabKey))).size
  const visiblePaneCount = stacked || !workspace ? 0 : workbench.groups.filter((group) => group.id !== focused.id && shownUri(group)).length
  const issues = [...(workspace?.errors.map((item) => `Could not read ${item}`) ?? []), ...keymap.problems.map((item) => `.serenity/workbench.yaml: ${item}`)]
  const workspaceName = workspace?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const editorContext = useMemo<EditorContext | null>(() => workspace ? {
    workspace, open: (uri, side) => { openResourceRef.current(uri, { side }) }, command: (id) => runCommandRef.current(id)
  } : null, [workspace])
  const openResourceRef = useRef(openResource)
  openResourceRef.current = openResource
  const runCommandRef = useRef(runCommand)
  runCommandRef.current = runCommand

  function viewContext(group: EditorGroup, snapshot: WorkspaceSnapshot): BuiltinViewContext {
    const tab = activeTabOf(group)
    return { workspace: snapshot, page: pageFor(group), editor: editorContext!,
      activeDocument: tab?.kind === 'document' ? tab.id : undefined, entityId: tab?.kind === 'entity' ? tab.id : undefined,
      presentation: tab ? group.presentations[tabKey(tab)] : undefined,
      focusedEventId, focusedTaskId, focusVersion, activity,
      onUpdate: setWorkspace, onError: (message) => { if (message) setError(message) },
      onOpenResource: (uri, side) => { openResource(uri, { group: group.id, side }) },
      onResolve: (id, accept) => { void resolveProposal(id, accept) }, onAttach: (id, entityId) => { void attachProposal(id, entityId) },
      onOpenSource: (name) => { openDocumentTab(name, group.id) }, onImport: () => { void importDocuments() }, onNewDocument: () => { void createDocument(group.id) }, onOpenDocument: (name) => { openDocumentTab(name, group.id) },
      onAnalyze: (name) => { openDocumentTab(name, group.id); startConversation(documentAnalysisPrompt(name)) },
      taskPresentation: group.viewPresentations.tasks === 'board' ? 'board' : 'list',
      onTaskPresentationChange: (presentation) => setWorkbench((current) => updateGroup(current, group.id, (item) => presentView(item, 'tasks', presentation))),
      calendarPresentation: group.viewPresentations.calendar === 'agenda' ? 'agenda' : 'month',
      onCalendarPresentationChange: (presentation) => setWorkbench((current) => updateGroup(current, group.id, (item) => presentView(item, 'calendar', presentation))),
      onOpenEntity: (id) => { openEntity(id, group.id) }, onNewEntity: () => setNewEntityOpen(true), onDiscuss: (question) => startConversation(question),
      onAsk: (prompt, scope) => startConversation(prompt, scope), searchQuery: searchSeeds[group.id] ?? ''
    }
  }

  function tabDrop(event: DragEvent<HTMLElement>): { group: string; key: string } | null {
    try {
      const data = JSON.parse(event.dataTransfer.getData(tabDragType)) as unknown
      return data && typeof data === 'object' && typeof (data as { group?: unknown }).group === 'string' && typeof (data as { key?: unknown }).key === 'string'
        ? data as { group: string; key: string } : null
    } catch { return null }
  }

  const assistantToggle = <button type="button" className="icon-btn" onClick={() => runCommand('assistant.toggle')} aria-pressed={rightOpen} aria-keyshortcuts={ariaShortcut('assistant.toggle')}
    aria-label={rightOpen ? 'Hide assistant' : 'Show assistant'} title={withShortcut(rightOpen ? 'Hide assistant' : 'Show assistant', 'assistant.toggle')}><PanelRight size={16}/></button>

  function newTabActions(groupId: string) {
    return [
      { id: 'page', label: 'New page', keys: shortcut('page.create'), run: () => { void createPage(groupId) } },
      { id: 'entity', label: 'New entity', keys: shortcut('entity.create'), run: () => setNewEntityOpen(true) },
      { id: 'search', label: 'Go to or search…', keys: shortcut('workspace.search'), run: () => setPaletteOpen(true) },
      ...(workspace?.pages.some((page) => page.id === workspace.workbench.homePage) ? [{ id: 'home', label: 'Open Home', run: () => { navigate('home', groupId) } }] : []),
      { id: 'ask', label: 'Ask Serenity', keys: shortcut('assistant.toggle'), run: () => startConversation() },
      ...(multipleGroups ? [{ id: 'close', label: 'Close pane', run: () => closeEditorGroup(groupId) }] : [])
    ]
  }

  function renderGroup(group: EditorGroup, snapshot: WorkspaceSnapshot, position: number): ReactNode {
    const isFocused = group.id === workbench.focused
    const rect = geometry.groups.get(group.id)
    const hidden = stacked && !isFocused
    const zone = dropTarget?.group === group.id ? dropTarget.zone : null
    const edge = stacked || !rect ? { top: true, left: true, right: true } :
      { top: rect.y < 0.001, left: rect.x < 0.001, right: rect.x + rect.width > 0.999 }
    const tab = activeTabOf(group)
    const options = tab ? presentations[tab.kind] : undefined
    const presentation = tab ? presentationFor(tab.kind, group.presentations[tabKey(tab)]) : undefined
    const view = tab ? tabViewOf(tab) : null
    const body = !tab ? <NewTabScreen actions={newTabActions(group.id)}/> :
      builtinViews.render(view!, viewContext(group, snapshot)) ?? <div className="empty-state"><h2>Not available</h2><p>This module is turned off in this workspace.</p></div>
    return <section key={group.id} data-group={group.id} tabIndex={-1} hidden={hidden}
      className={`pane ${isFocused && multipleGroups ? 'focused' : ''} ${edge.top ? 'edge-top' : ''} ${edge.left ? 'edge-left' : ''} ${edge.right ? 'edge-right' : ''}`}
      style={stacked || !rect ? undefined : percentRect(rect)}
      aria-label={multipleGroups ? `${groupTitle(group)} · pane ${position}` : groupTitle(group)} aria-current={multipleGroups && isFocused ? 'true' : undefined}
      onMouseDownCapture={() => focusGroup(group.id)} onFocusCapture={() => focusGroup(group.id)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(tabDragType)) return
        event.preventDefault()
        const next = dropZoneAt(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
        if (dropTarget?.group !== group.id || dropTarget.zone !== next) setDropTarget({ group: group.id, zone: next })
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) }}
      onDrop={(event) => {
        const dragged = tabDrop(event)
        setDropTarget(null)
        if (!dragged) return
        event.preventDefault()
        dropTab(dragged.group, dragged.key, group.id, dropZoneAt(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY))
      }}>
      <PaneHeader group={group.id} position={multipleGroups ? position : undefined} active={group.activeTab}
        tabs={group.tabs.map((item) => ({ key: tabKey(item), tab: item, title: tabTitle(snapshot, item) }))}
        splittable={canSplit} closable={multipleGroups}
        onSelect={(key) => setWorkbench((current) => updateGroup({ ...current, focused: group.id }, group.id, (item) => { const selected = item.tabs.find((entry) => tabKey(entry) === key); return selected ? showTab(item, selected) : item }))}
        onClose={(key) => closeTab(key, group.id)} onNewTab={() => setWorkbench((current) => ({ ...updateGroup(current, group.id, (item) => showView(item, 'home')), focused: group.id }))}
        onDropTab={(dragged, before) => { setDropTarget(null); dropTab(dragged.group, dragged.key, group.id, 'center', before) }}
        onSplit={(direction) => splitPane(direction, group.id)} onClosePane={() => closeEditorGroup(group.id)}
        menu={[...(tab && multipleGroups ? [{ id: 'move', label: 'Move tab to next pane', icon: <MoveRight size={14}/>, run: () => moveTabToOtherGroup(group.id) }] : []),
          ...(tab ? [{ id: 'close-tab', label: 'Close tab', icon: <X size={14}/>, run: () => closeTab(tabKey(tab), group.id) }] : []),
          ...(tab && isResourceTab(tab) && !(tab.kind === 'page' && tab.id === snapshot.workbench.homePage) ? [{ id: 'archive', label: 'Move to archive…', icon: <Archive size={14}/>, danger: true, separated: true, run: () => void archiveResource(resourceUri(tab)) }] : [])]}
        trailing={edge.top && edge.right && !rightOpen && mode === 'workspace' ? assistantToggle : undefined}
        tabMenu={(key) => {
          const index = group.tabs.findIndex((item) => tabKey(item) === key)
          const closeAll = (keys: string[]) => setWorkbench((current) => updateGroup(current, group.id, (item) => keys.reduce(removeTab, item)))
          return [
            { id: 'close', label: 'Close tab', icon: <X size={14}/>, detail: shortcut('tab.close'), run: () => closeTab(key, group.id) },
            { id: 'others', label: 'Close other tabs', disabled: group.tabs.length < 2, run: () => closeAll(group.tabs.map(tabKey).filter((item) => item !== key)) },
            { id: 'right', label: 'Close tabs to the right', disabled: index === group.tabs.length - 1, run: () => closeAll(group.tabs.slice(index + 1).map(tabKey)) },
            { id: 'split', label: 'Open in new pane to the right', icon: <Columns2 size={14}/>, separated: true, disabled: !canSplit,
              run: () => dropTab(group.id, key, group.id, 'right') },
            ...(multipleGroups ? [{ id: 'move', label: 'Move to next pane', icon: <MoveRight size={14}/>, run: () => { const target = nextGroupId(workbench, group.id); if (target) setWorkbench((current) => moveTab(current, group.id, key, target)) } }] : []),
            ...((() => { const item = group.tabs[index]; return item && isResourceTab(item) && !(item.kind === 'page' && item.id === snapshot.workbench.homePage)
              ? [{ id: 'archive', label: 'Move to archive…', icon: <Archive size={14}/>, danger: true, separated: true, run: () => void archiveResource(resourceUri(item)) }] : [] })())
          ]
        }}/>
      {tab && isResourceTab(tab) && <div className="view-bar">
        <nav className="view-path" aria-label="Location" title={tabPath(snapshot, tab)}>{breadcrumb(snapshot, tab).map((crumb, index, all) =>
          <span key={index} className={index === all.length - 1 ? 'current' : ''}>{crumb}</span>)}</nav>
        {options && options.length > 1 && presentation && <PresentationSwitcher kind={tab.kind} active={presentation} onChange={(id) => changePresentation(group.id, tab, id)}/>}
      </div>}
      {/* Focusable so keyboard users can scroll a long view; its label names what it shows. */}
      <div className="pane-body" key={group.activeTab ?? 'empty'} tabIndex={0} role="region" aria-label={`${groupTitle(group)} content`}>
        <ErrorBoundary label={groupTitle(group)}>{body}</ErrorBoundary>
      </div>
      {zone && <div className={`pane-drop-overlay zone-${zone}`} aria-hidden="true"/>}
    </section>
  }

  function renderPanes(snapshot: WorkspaceSnapshot): ReactNode {
    const ordered = orderedGroups(workbench)
    return <>
      {stacked && <nav className="pane-switcher" aria-label="Panes">{ordered.map((group, index) =>
        <button key={group.id} className={group.id === workbench.focused ? 'active' : ''} aria-current={group.id === workbench.focused ? 'true' : undefined}
          onClick={() => focusGroup(group.id)}>{index + 1}. {groupTitle(group)}</button>)}</nav>}
      <div className={`panes ${multipleGroups ? 'split' : ''} ${stacked ? 'stacked' : ''}`} ref={paneArea}>
        {ordered.map((group, index) => renderGroup(group, snapshot, index + 1))}
        {!stacked && geometry.dividers.map((divider) => <PaneDivider key={`${divider.path.join('.')}:${divider.index}`} divider={divider} area={paneArea}
          onResize={resizePanes} onReset={(path) => resizePanes(path, divider.sizes.map(() => 1))}/>)}
      </div>
    </>
  }

  const askScope = workspace && results?.length ? scopeFromResults(results, workspace) : null
  const suggestions = workspace ? <ConversationSuggestions workspace={workspace} conversationId={conversationId}
    onResolve={(id, accept) => { void resolveProposal(id, accept) }} onAttach={(id, entityId) => { void attachProposal(id, entityId) }}
    onOpenSource={(name) => { openDocumentTab(name) }}/> : null
  const assistantState = assistant as unknown as AssistantState
  const newChat = (): void => startConversation()
  const chatIntro = (heading: string) => <div className="chat-intro"><h1>{heading}</h1>
    <p>Ask about anything in this workspace. Answers cite the records they used, and suggested changes wait for your review.</p></div>
  const activeView = focusedTab ? tabViewOf(focusedTab) : null
  const showLeft = leftOpen && Boolean(workspace)
  const showRight = workspace && mode === 'workspace' && rightOpen

  return <div className={`app mode-${mode} ${switchingMode ? 'switching-mode' : ''} ${showLeft ? 'left-open' : 'left-closed'} ${showRight ? 'right-open' : 'right-closed'} ${narrow ? 'narrow' : ''} ${workspace ? '' : 'no-workspace'}`}
    data-platform={platform} style={{ '--left-width': `${leftWidth}px`, '--right-width': `${rightWidth}px` } as CSSProperties}>
    <header className="titlebar-start">
      {workspace && <>
        <button type="button" className="icon-btn" onClick={() => runCommand('navigation.toggle')} aria-pressed={leftOpen} aria-keyshortcuts={ariaShortcut('navigation.toggle')}
          aria-label={leftOpen ? 'Hide sidebar' : 'Show sidebar'} title={withShortcut(leftOpen ? 'Hide sidebar' : 'Show sidebar', 'navigation.toggle')}><PanelLeft size={16}/></button>
      </>}
    </header>
    {workspace && <Ribbon commands={commands} navigation={workspace.workbench.navigation} activeView={activeView} homeShown={focusedTab?.kind === 'page' && focusedTab.id === workspace.workbench.homePage} pendingCount={pending.length}
      mode={mode} onMode={setMode} modeShortcut={shortcut('assistant.expand')} shortcutFor={shortcut} onCommand={runCommand}/>}
    {workspace && <aside className="left-sidebar" aria-label={mode === 'chat' ? 'Chats' : 'Workspace'} inert={!showLeft} aria-hidden={!showLeft}>
      {mode === 'workspace' ? <Explorer workspace={workspace} activeUri={shownUri(focused)} onOpen={(uri, side) => { openResource(uri, { side }) }}
        onNewPage={() => void createPage()} onNewEntity={() => setNewEntityOpen(true)} onImport={() => void importDocuments()} onArchive={(uri) => void archiveResource(uri)}/> :
        <div className="chat-sidebar">
          <button type="button" className="sidebar-action" onClick={newChat}><MessageSquarePlus size={15}/> New chat</button>
          <ConversationList workspace={workspace} activeId={conversationId} busy={assistant.busy} onSelect={(item: Conversation) => selectConversation(item)}/>
        </div>}
      <div className="sidebar-footer">
        <MenuButton label="Workspace" className="workspace-switcher" align="start" header={<span className="menu-path">{workspace.path}</span>} items={[
          { id: 'reveal', label: platform === 'mac' ? 'Reveal in Finder' : 'Open folder', icon: <FolderOpen size={14}/>, run: () => runCommand('workspace.open-folder') },
          { id: 'choose', label: 'Open another workspace…', icon: <FolderOpen size={14}/>, run: () => runCommand('workspace.choose') },
          ...(recent ?? []).filter((item) => item.path !== workspace.path && item.available).slice(0, 5).map((item, index) =>
            ({ id: `recent:${item.path}`, label: item.name, detail: index === 0 ? 'Recent' : undefined, separated: index === 0, run: () => { void chooseWorkspace(item.path) } })),
          { id: 'refresh', label: 'Reload files', icon: <RotateCw size={14}/>, run: () => runCommand('workspace.refresh') }
        ]}><span className="workspace-avatar" aria-hidden="true">{workspaceName.slice(0, 1).toUpperCase()}</span><span className="workspace-name">{workspaceName}</span><ChevronDown size={13}/></MenuButton>
        {issues.length > 0 && <button type="button" className="icon-btn warning" onClick={() => setIssuesOpen(true)} aria-label={`${issues.length} workspace ${issues.length === 1 ? 'issue' : 'issues'}`}
          title={`${issues.length} workspace ${issues.length === 1 ? 'issue' : 'issues'}`}><AlertTriangle size={15}/></button>}
      </div>
      {!narrow && <SidebarResizer side="left" width={leftWidth} min={200} max={440} onResize={setLeftWidth}/>}
    </aside>}
    <main className="main" id="workspace-main">
      {!workspace ? <Welcome recent={recent} onChoose={() => void chooseWorkspace()} onOpenRecent={(path) => void chooseWorkspace(path)}
        onForget={(path) => { void window.serenity.forgetRecentWorkspace(path).then(setRecent) }}/> : mode === 'chat' ? <section className="chat-main" aria-label="Chat">
        <header className="chat-header">
          <h1 className="chat-heading" title={assistant.conversation?.title}>{assistant.conversation?.title ?? 'New chat'}</h1>
          <div className="chat-header-actions">
            <button type="button" className="icon-btn" onClick={newChat} aria-label="New chat" title={withShortcut('New chat', 'assistant.new')}><MessageSquarePlus size={16}/></button>
            <MenuButton label="Chat actions" align="end" items={[
              { id: 'settings', label: 'Conversation settings…', icon: <Settings2 size={14}/>, run: () => setConversationSettingsOpen(true) },
              ...(assistant.conversationId ? [{ id: 'delete', label: 'Delete this chat', icon: <Trash2 size={14}/>, danger: true, separated: true, run: () => void assistant.deleteConversation() }] : [])
            ]}><MoreHorizontal size={16}/></MenuButton>
          </div>
        </header>
        <ErrorBoundary label="The conversation">
          <div className={`chat-body ${assistant.conversation || assistant.busy ? '' : 'empty'}`}>
            <div className="chat-scroll" tabIndex={0} role="region" aria-label="Messages">
              <ConversationView assistant={assistantState} intro={chatIntro('What’s on your mind?')} onOpenResource={(uri, side) => { openResource(uri, { side }) }} suggestions={suggestions}/>
            </div>
            <div className="chat-composer"><Composer assistant={assistantState} onOpenSettings={() => setConversationSettingsOpen(true)} autoFocus/></div>
          </div>
        </ErrorBoundary>
      </section> : renderPanes(workspace)}
    </main>
    {showRight && <aside className="right-sidebar assistant-panel" aria-label="Assistant">
      {!narrow && <SidebarResizer side="right" width={rightWidth} min={300} max={640} onResize={setRightWidth}/>}
      <header className="assistant-header">
        <h2 className="chat-heading small" title={assistant.conversation?.title}>{assistant.conversation?.title ?? 'New chat'}</h2>
        <div className="assistant-actions">
          <MenuButton label="Chat history" title="Chat history" align="end" items={conversationMenu(workspace, assistantState, newChat)}><History size={15}/></MenuButton>
          <button type="button" className="icon-btn" onClick={newChat} aria-label="New chat" title={withShortcut('New chat', 'assistant.new')}><MessageSquarePlus size={16}/></button>
          <button type="button" className="icon-btn" onClick={() => setMode('chat')} aria-label="Open this chat full window" title={withShortcut('Open this chat full window', 'assistant.expand')}><Maximize2 size={15}/></button>
          {assistantToggle}
        </div>
      </header>
      <ErrorBoundary label="The assistant">
        <div className="assistant-scroll" tabIndex={0} role="region" aria-label="Messages">
          <ConversationView assistant={assistantState} onOpenResource={(uri, side) => { openResource(uri, { side }) }} suggestions={suggestions}
            intro={<div className="chat-intro compact"><h2>{activeFile ? `Ask about ${activeFile.name}` : 'Ask about your workspace'}</h2>
              <p>{activeFile?.allowed ? 'What’s open in your panes can inform the answer.' : 'Answers cite their sources, and suggested changes wait for your review.'}</p></div>}/>
        </div>
        <div className="assistant-composer"><Composer assistant={assistantState} onOpenSettings={() => setConversationSettingsOpen(true)}
          context={<ContextChips active={activeFile} visiblePanes={visiblePaneCount} openFiles={openFileCount}/>}/></div>
      </ErrorBoundary>
    </aside>}
    {narrow && (showLeft || showRight) && <div className="scrim" onClick={() => { setLeftOpen(false); setRightOpen(false) }} aria-hidden="true"/>}
    {errors.length > 0 && <div className="toasts" role="alert">{errors.map((item) => <div key={item.id} className="toast">
      <AlertTriangle size={14}/><span>{item.text}</span>
      <button type="button" className="icon-btn" onClick={() => setErrors((current) => current.filter((entry) => entry.id !== item.id))} aria-label="Dismiss"><X size={14}/></button>
    </div>)}</div>}
    {workspace && <CommandPalette open={paletteOpen} query={query} results={results} searching={searching} provider={assistant.provider} savedIndexEnabled={Boolean(workspace.modules.semanticIndex)}
      commands={commands.filter((command) => !command.hideInPalette)} shortcutFor={shortcut} onChange={(value) => void searchText(value)} onClose={closePalette} onSelect={openSearchResult}
      onAISearch={() => void searchSemantically()} onSavedSearch={() => void searchSavedConcepts()}
      onKeepInPane={() => { const kept = query; setSearchSeeds((seeds) => ({ ...seeds, [workbench.focused]: kept })); closePalette(); navigate('search') }}
      onAskAboutResults={askScope && (askScope.entityIds.length || askScope.documentNames.length) ? () => { closePalette(); startConversation(`About “${query.trim()}”: `, askScope) } : undefined}
      onCommand={runCommand}/>}
    {workspace && settingsOpen && <SettingsDialog workspace={workspace} shortcuts={shortcuts} theme={theme} onThemeChange={setTheme} onClose={() => setSettingsOpen(false)}
      onChooseWorkspace={() => { setSettingsOpen(false); void chooseWorkspace() }} onOpenFolder={() => runCommand('workspace.open-folder')}
      onUpdate={setWorkspace} onError={(message) => { if (message) setError(message) }}/>}
    {workspace && newEntityOpen && <NewEntityDialog workspace={workspace} onCreate={createEntity} onOpen={(id) => { openEntity(id) }} onClose={() => setNewEntityOpen(false)}/>}
    {workspace && conversationSettingsOpen && <ConversationSettings workspace={workspace} assistant={assistantState} onClose={() => setConversationSettingsOpen(false)}/>}
    {issuesOpen && <Dialog title="Workspace issues" onClose={() => setIssuesOpen(false)} className="settings-small">
      <p className="hint">Serenity keeps these files as they are. Fix them in another editor and the workspace updates.</p>
      <ul className="issue-list">{issues.map((item) => <li key={item}>{item}</li>)}</ul>
    </Dialog>}
  </div>
}


createRoot(document.getElementById('root')!).render(<ErrorBoundary label="Serenity" fullScreen><App /></ErrorBoundary>)
