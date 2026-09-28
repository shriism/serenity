import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { externalLink } from '../shared/external-links'
import { fileURLToPath } from 'node:url'
import { watchWorkspace } from './workspace-watcher'
import { Workspace } from './workspace'
import { sendMessage } from './conversation'
import { credentialStatus, saveCredential } from './credentials'
import { semanticSearch } from './semantic'
import { buildSemanticIndex, rankSemanticIndex } from './semantic-index'
import { askProvider } from './providers'
import { analyzeChangedDocument } from './document-analysis'
import { extractDocument } from './documents'
import { RecentWorkspaces } from './recent-workspaces'
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Autonomy, CalendarEvent, Claim, Entity, Provider, ReadScope, TaskItem, WorkflowPermissions, WorkbenchSession, WorkspacePage, WorkspaceSnapshot } from '../shared/types'
import type { ModuleId } from '../shared/modules'

let window: BrowserWindow | null = null
let workspace: Workspace | null = null
let watcher: { close(): void } | null = null
let editorDirty = false
/** Times of recent renderer crashes, to stop reloading a window that fails every time it starts. */
let rendererCrashes: number[] = []
let closePromptOpen = false
let closeApproved = false
let activeRequests = 0
let conversationAbort: AbortController | null = null
let indexTimer: ReturnType<typeof setTimeout> | null = null
let indexRunning = false
let indexPending = false
let indexAbort: AbortController | null = null
const pendingDocuments = new Set<string>()
let documentTimer: ReturnType<typeof setTimeout> | null = null
let documentsRunning = false
let documentAbort: AbortController | null = null

async function withActiveRequest<T>(work: () => Promise<T>): Promise<T> {
  activeRequests++
  try { return await work() }
  finally { activeRequests-- }
}

function currentWorkspace(): Workspace {
  if (!workspace) throw new Error('Choose a workspace to continue.')
  return workspace
}

function pauseBackgroundIndex(): void {
  indexAbort?.abort()
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = null
}

function pauseDocumentAnalysis(): void {
  documentAbort?.abort()
  pendingDocuments.clear()
  if (documentTimer) clearTimeout(documentTimer)
  documentTimer = null
}

let searchWarmTimer: ReturnType<typeof setTimeout> | null = null

/** Rebuilds the full-text index in the background once changes settle, so a search does not wait for it. */
function warmSearchIndex(target: Workspace, delay = 1500): void {
  if (searchWarmTimer) clearTimeout(searchWarmTimer)
  searchWarmTimer = setTimeout(() => {
    searchWarmTimer = null
    if (workspace === target) void target.refreshSearchIndex().catch((error) => console.error('Search index could not be rebuilt:', error))
  }, delay)
}

function scheduleSemanticIndex(target: Workspace): void {
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = setTimeout(() => {
    indexTimer = null
    if (workspace !== target) return
    if (indexRunning) { indexPending = true; return }
    indexRunning = true
    const controller = new AbortController()
    indexAbort = controller
    void withActiveRequest(() => buildSemanticIndex(target, askProvider, controller.signal)).then(() => {
      window?.webContents.send('workspace:changed')
    }).catch((error) => {
      if (!controller.signal.aborted) window?.webContents.send('semantic:index-error', String(error))
    }).finally(() => {
      indexAbort = null
      indexRunning = false
      if (indexPending && workspace === target) { indexPending = false; scheduleSemanticIndex(target) }
    })
  }, 1800)
}

function queueDocumentAnalysis(target: Workspace, filename: string): void {
  pendingDocuments.add(filename)
  if (documentTimer) clearTimeout(documentTimer)
  documentTimer = setTimeout(() => {
    documentTimer = null
    if (documentsRunning || workspace !== target) return
    documentsRunning = true
    void (async () => {
      try {
        while (pendingDocuments.size && workspace === target) {
          const name = pendingDocuments.values().next().value!
          pendingDocuments.delete(name)
          const controller = new AbortController()
          documentAbort = controller
          try {
            await withActiveRequest(() => analyzeChangedDocument(target, name, sendMessage, controller.signal))
            window?.webContents.send('workspace:changed')
          } catch (error) {
            if (!controller.signal.aborted) window?.webContents.send('semantic:index-error', `Document ${name}: ${String(error)}`)
          } finally { documentAbort = null }
        }
      } finally {
        documentsRunning = false
        if (pendingDocuments.size && workspace === target) queueDocumentAnalysis(target, pendingDocuments.values().next().value!)
      }
    })()
  }, 1200)
}

// Kept in the app's settings folder, never in a workspace; created once the app is ready and its paths are known.
let recentWorkspaces: RecentWorkspaces | null = null

async function openWorkspace(path: string): Promise<WorkspaceSnapshot> {
  if (searchWarmTimer) clearTimeout(searchWarmTimer)
  if (indexTimer) clearTimeout(indexTimer)
  if (documentTimer) clearTimeout(documentTimer)
  pendingDocuments.clear()
  await watcher?.close()
  workspace?.close()
  const next = new Workspace(path)
  await next.initialize()
  workspace = next
  const settingsDirectory = '.serenity'
  watcher = watchWorkspace(next.path, (paths) => {
    if (workspace !== next) return
    next.markDirty()
    const settings = paths.filter((path) => path.split(/[\\/]/)[0] === settingsDirectory).map((path) => basename(path))
    const content = paths.filter((path) => path.split(/[\\/]/)[0] !== settingsDirectory)
    if (content.length) {
      scheduleSemanticIndex(next)
      warmSearchIndex(next)
      // Added or changed documents (not removals) are candidates for automatic analysis.
      for (const path of content) {
        const parts = path.split(/[\\/]/)
        if (parts[0] === 'documents' && parts.length === 2) void stat(join(next.path, path)).then((info) => { if (info.isFile() && workspace === next) queueDocumentAnalysis(next, parts[1]) }, () => undefined)
      }
    }
    if (!settings.some((name) => name !== 'workbench.yaml')) { window?.webContents.send('workspace:changed'); return }
    void next.snapshot().then((snapshot) => {
      if (settings.includes('semantic-provider.yaml') || !snapshot.modules.semanticIndex) pauseBackgroundIndex()
      if (snapshot.modules.semanticIndex) scheduleSemanticIndex(next)
      if (!snapshot.modules.documentAnalysis) pauseDocumentAnalysis()
      window?.webContents.send('workspace:changed')
    }).catch((error) => window?.webContents.send('semantic:index-error', String(error)))
  }, (error) => console.error('Workspace watcher stopped reporting changes:', error))
  scheduleSemanticIndex(next)
  // Early enough to be ready for a first search, late enough not to compete with opening the window.
  warmSearchIndex(next, 4000)
  await recentWorkspaces?.add(next.path).catch((error) => console.error('Could not remember this workspace:', error))
  return next.snapshot()
}

// Title bar controls drawn by the system follow the app's appearance.
const windowColors = { dark: { background: '#19191b', symbol: '#c9c9cf' }, light: { background: '#f3f3f4', symbol: '#3a3a40' } } as const
let windowTheme: keyof typeof windowColors = 'dark'

// `--background` runs without taking focus or showing a window, e.g. for automated checks while someone keeps working.
const background = process.argv.includes('--background')

/**
 * The application menu. Workbench items run renderer commands; their shortcuts are shown here but handled by the
 * renderer's keymap (so a workspace can rebind them), while standard items such as Copy and Quit keep system behavior.
 */
function applicationMenu(): Menu {
  const command = (label: string, id: string, accelerator?: string): MenuItemConstructorOptions =>
    ({ label, accelerator, registerAccelerator: false, click: () => window?.webContents.send('menu:command', id) })
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, command('Settings…', 'view.settings', 'CmdOrCtrl+,'), { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      command('New Page', 'page.create', 'CmdOrCtrl+N'), command('New Entity', 'entity.create'), command('New Tab', 'tab.new', 'CmdOrCtrl+T'), { type: 'separator' },
      command('Open Another Workspace…', 'workspace.choose', 'CmdOrCtrl+O'), command('Import Documents…', 'documents.import'),
      command(mac ? 'Reveal Workspace in Finder' : 'Open Workspace Folder', 'workspace.open-folder'), { type: 'separator' },
      command('Close Tab', 'tab.close', 'CmdOrCtrl+W'), { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
      ...(mac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, command('Settings…', 'view.settings', 'CmdOrCtrl+,'), { role: 'quit' } as MenuItemConstructorOptions])
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      command('Search…', 'workspace.search', 'CmdOrCtrl+K'), command('Search in a Pane', 'view.search', 'CmdOrCtrl+Shift+F'), { type: 'separator' },
      command('Toggle Sidebar', 'navigation.toggle', 'CmdOrCtrl+B'), command('Toggle Assistant', 'assistant.toggle', 'CmdOrCtrl+J'),
      command('Switch Between Workspace and Chat', 'assistant.expand', 'CmdOrCtrl+Shift+J'), { type: 'separator' },
      command('Split Right', 'layout.split', 'CmdOrCtrl+\\'), command('Split Down', 'layout.split-down', 'CmdOrCtrl+Shift+\\'),
      command('Next Tab', 'tab.next', 'CmdOrCtrl+Shift+]'), command('Previous Tab', 'tab.previous', 'CmdOrCtrl+Shift+['), { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'reload' } as MenuItemConstructorOptions, { role: 'toggleDevTools' } as MenuItemConstructorOptions])
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [command('Keyboard Shortcuts', 'view.settings'), { label: 'Serenity on GitHub', click: () => void shell.openExternal('https://github.com/shriism/serenity') }] }
  ]
  return Menu.buildFromTemplate(template)
}

function createWindow(): void {
  closeApproved = false
  window = new BrowserWindow({
    show: !background,
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    title: 'Serenity',
    // The window's content reaches the top edge, like other native workbenches: tabs sit in the title bar, beside
    // the macOS traffic lights or under Windows and Linux window controls drawn by the system.
    titleBarStyle: 'hidden',
    backgroundColor: windowColors[windowTheme].background,
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 13 } } :
      { titleBarOverlay: { color: windowColors[windowTheme].background, symbolColor: windowColors[windowTheme].symbol, height: 40 } }),
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !background
    }
  })
  window.on('closed', () => { window = null; closeApproved = false })
  // A crashed or killed renderer leaves a blank window. Workspace files are only written through validated
  // operations, so reloading is safe; only unsaved editor text is lost, and the person is told so.
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    console.error(`Renderer process ended: ${details.reason} (exit code ${details.exitCode})`)
    const current = window
    if (!current || current.isDestroyed()) return
    editorDirty = false
    // A renderer that fails as it starts would otherwise be reloaded forever.
    const now = Date.now()
    rendererCrashes = [...rendererCrashes.filter((at) => now - at < 60000), now]
    const repeated = rendererCrashes.length >= 3
    if (background) { if (!repeated) current.webContents.reload(); else console.error('Renderer keeps failing; not reloading again'); return }
    void dialog.showMessageBox(current, { type: 'warning', buttons: repeated ? ['Quit', 'Try again'] : ['Reload'], defaultId: repeated ? 1 : 0, cancelId: 0,
      message: repeated ? 'Serenity’s window keeps stopping' : 'Serenity’s window stopped unexpectedly',
      detail: `Your workspace files are safe. Text you had not saved in an open editor may be lost.${repeated ? ` The window failed ${rendererCrashes.length} times in the last minute (${details.reason}).` : ''}` })
      .then(({ response }) => {
        if (current.isDestroyed()) return
        if (repeated && response === 0) { closeApproved = true; app.quit(); return }
        if (repeated) rendererCrashes = []
        current.webContents.reload()
      })
  })
  window.on('close', (event) => {
    if (closeApproved || (!editorDirty && !activeRequests) || !window) return
    event.preventDefault()
    if (closePromptOpen) return
    closePromptOpen = true
    const closingWindow = window
    void dialog.showMessageBox(closingWindow, {
      type: 'question', title: 'Close Serenity?',
      message: editorDirty && activeRequests ? 'Discard unsaved edits and interrupt active AI work?' :
        editorDirty ? 'Discard your unsaved entity edits?' : 'Interrupt active AI work?',
      buttons: ['Keep working', 'Close Serenity'], defaultId: 0, cancelId: 0
    }).then(({ response }) => {
      if (response === 1 && !closingWindow.isDestroyed()) {
        conversationAbort?.abort()
        editorDirty = false
        closeApproved = true
        closingWindow.close()
      }
    }).catch(() => undefined).finally(() => { closePromptOpen = false })
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }
}

// Background work (indexing, analysis) reports its own failures; anything that slips past is logged, not silently lost.
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection in the main process:', reason))

app.whenReady().then(async () => {
  ipcMain.on('editor:dirty', (_event, dirty: unknown) => { editorDirty = dirty === true })
  // Plain text only, and bounded; the renderer has no clipboard access of its own.
  ipcMain.on('clipboard:write', (_event, text: unknown) => { if (typeof text === 'string' && text.length <= 10000) clipboard.writeText(text) })
  ipcMain.on('window:theme', (event, theme: unknown) => {
    if (theme !== 'dark' && theme !== 'light') return
    windowTheme = theme
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || target.isDestroyed()) return
    target.setBackgroundColor(windowColors[theme].background)
    if (process.platform !== 'darwin') target.setTitleBarOverlay({ color: windowColors[theme].background, symbolColor: windowColors[theme].symbol, height: 40 })
  })
  /** Whether the current workspace may be left: no AI request running, and any unsaved edits knowingly discarded. */
  async function mayLeaveWorkspace(): Promise<boolean> {
    if (activeRequests) throw new Error('Wait for the current AI request before switching workspaces.')
    if (!editorDirty || !window) return true
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', title: 'Unsaved changes', message: 'Discard unsaved edits before changing workspaces?',
      buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0
    })
    return response === 1
  }
  ipcMain.handle('workspace:recent', () => recentWorkspaces?.list() ?? [])
  ipcMain.handle('workspace:open-recent', async (_event, path: unknown) => {
    // Only a folder the person chose before can be reopened this way.
    if (typeof path !== 'string' || !recentWorkspaces || !await recentWorkspaces.includes(path)) throw new Error('That workspace is not in the recent list')
    if (!await mayLeaveWorkspace()) return null
    const snapshot = await openWorkspace(path)
    editorDirty = false
    return snapshot
  })
  ipcMain.handle('workspace:forget-recent', async (_event, path: unknown) => {
    if (typeof path === 'string') await recentWorkspaces?.remove(path)
    return recentWorkspaces?.list() ?? []
  })
  ipcMain.handle('workspace:choose', async () => {
    if (!await mayLeaveWorkspace()) return null
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a Serenity workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const snapshot = await openWorkspace(result.filePaths[0])
    editorDirty = false
    return snapshot
  })
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    platform: `${process.platform} ${process.getSystemVersion()} (${process.arch})` }))
  ipcMain.handle('link:open-external', async (_event, url: unknown) => {
    const link = externalLink(url)
    if (!link) throw new Error('Only web and email links can be opened')
    await shell.openExternal(link)
  })
  ipcMain.handle('workspace:open-folder', async () => {
    const error = await shell.openPath(currentWorkspace().path)
    if (error) throw new Error(error)
  })
  ipcMain.handle('workspace:refresh', () => {
    if (!workspace) return null
    // A refresh rechecks every file, so the search index is rebuilt too, in the background rather than on the next search.
    workspace.markDirty()
    warmSearchIndex(workspace, 300)
    return workspace.snapshot()
  })
  ipcMain.handle('entity:save', (_event, entity: Entity) => currentWorkspace().saveEntity(entity))
  ipcMain.handle('page:save', (_event, page: Pick<WorkspacePage, 'id' | 'path' | 'text' | 'revision'>) => currentWorkspace().savePage(page))
  ipcMain.handle('page:create', () => currentWorkspace().createPage())
  ipcMain.handle('wikilinks:rename', (_event, from: string, to: string, uris: string[]) => currentWorkspace().renameWikilinks(from, to, uris))
  ipcMain.handle('workspace:session:load', () => currentWorkspace().loadSession())
  ipcMain.handle('workspace:session:save', (_event, session: WorkbenchSession) => currentWorkspace().saveSession(session))
  ipcMain.handle('claim:add', (_event, claim: Pick<Claim, 'subject' | 'key' | 'value' | 'source'>) => currentWorkspace().addClaim(claim))
  ipcMain.handle('claim:retract', (_event, id: string, reason: string) => currentWorkspace().retractClaim(id, reason))
  ipcMain.handle('claim:current', (_event, id: string, reason: string) => currentWorkspace().setCurrentClaim(id, reason))
  ipcMain.handle('claim:current-clear', (_event, subject: string, key: string) => currentWorkspace().clearCurrentClaim(subject, key))
  ipcMain.handle('document:import', async () => {
    const files = await dialog.showOpenDialog(window!, { title: 'Import documents', properties: ['openFile', 'multiSelections'] })
    if (files.canceled) return null
    for (const path of files.filePaths) await currentWorkspace().importDocument(path)
    return currentWorkspace().snapshot()
  })
  ipcMain.handle('document:open', async (_event, name: string) => {
    if (typeof name !== 'string' || !name || basename(name) !== name || name === '.' || name === '..') {
      throw new Error('Invalid document name')
    }
    const selected = currentWorkspace()
    if (!(await selected.snapshot()).documents.some((item) => item.name === name)) throw new Error('Document not found in this workspace')
    const error = await shell.openPath(await selected.documentPath(name))
    if (error) throw new Error(error)
  })
  ipcMain.handle('document:read', async (_event, name: string) => {
    if (typeof name !== 'string' || !name || basename(name) !== name || name === '.' || name === '..') throw new Error('Invalid document name')
    const selected = currentWorkspace()
    if (!(await selected.snapshot()).documents.some((item) => item.name === name && item.extractable)) throw new Error('Readable document not found in this workspace')
    return extractDocument(await selected.documentPath(name))
  })
  ipcMain.handle('workspace:search', (_event, query: string) => currentWorkspace().search(query))
  ipcMain.handle('workspace:semantic-search', (_event, query: string, provider: Provider) => withActiveRequest(() => semanticSearch(currentWorkspace(), query, provider)))
  ipcMain.handle('workspace:cached-semantic-search', (_event, query: string) => rankSemanticIndex(currentWorkspace(), query))
  ipcMain.handle('conversation:send', async (_event, input: { conversationId?: string; text: string; provider: Provider; autonomy: Autonomy; retained: boolean; permissions?: WorkflowPermissions; readScope?: ReadScope; activeRef?: string; visibleRefs?: string[]; openRefs?: string[] }) => {
    if (conversationAbort) throw new Error('Another conversation request is still running')
    const controller = new AbortController()
    conversationAbort = controller
    const timeout = setTimeout(() => controller.abort(), 150000)
    try { return await withActiveRequest(() => sendMessage(currentWorkspace(), input, controller.signal)) }
    finally { clearTimeout(timeout); conversationAbort = null }
  })
  ipcMain.handle('conversation:cancel', () => {
    if (!conversationAbort) return false
    conversationAbort.abort()
    return true
  })
  ipcMain.handle('conversation:settings', (_event, id: string, settings: { autonomy: Autonomy; permissions: WorkflowPermissions; retained: boolean; readScope?: ReadScope }) => currentWorkspace().updateConversationSettings(id, settings))
  ipcMain.handle('proposal:resolve', (_event, id: string, accept: boolean) => currentWorkspace().resolveProposal(id, accept))
  ipcMain.handle('proposal:attach-entity', (_event, proposalId: string, entityId: string) => currentWorkspace().attachEntityProposal(proposalId, entityId))
  ipcMain.handle('conversation:delete', (_event, id: string) => currentWorkspace().deleteConversation(id))
  ipcMain.handle('credential:status', () => credentialStatus())
  ipcMain.handle('credential:save', async (_event, provider: Provider, key: string) => {
    await saveCredential(provider, key)
    return credentialStatus()
  })
  ipcMain.handle('module:set', async (_event, id: ModuleId, enabled: boolean) => {
    const selected = currentWorkspace()
    const snapshot = await selected.setModule(id, enabled)
    if (!enabled && id === 'semanticIndex') pauseBackgroundIndex()
    if (!enabled && id === 'documentAnalysis') pauseDocumentAnalysis()
    if (id === 'semanticIndex' && enabled) scheduleSemanticIndex(selected)
    return snapshot
  })
  ipcMain.handle('semantic:provider', async (_event, provider: Provider) => {
    const selected = currentWorkspace()
    const snapshot = await selected.setSemanticProvider(provider)
    pauseBackgroundIndex()
    if (snapshot.modules.semanticIndex) scheduleSemanticIndex(selected)
    return snapshot
  })
  ipcMain.handle('calendar:save', (_event, item: CalendarEvent) => currentWorkspace().saveEvent(item))
  ipcMain.handle('page:archive', (_event, id: string, revision: string) => currentWorkspace().archivePage(id, revision))
  ipcMain.handle('task:save', (_event, item: TaskItem) => currentWorkspace().saveTask(item))
  ipcMain.handle('calendar:archive', (_event, id: string, revision: string) => currentWorkspace().archiveEvent(id, revision))
  ipcMain.handle('calendar:restore', (_event, id: string) => currentWorkspace().restoreEvent(id))
  ipcMain.handle('task:archive', (_event, id: string, revision: string) => currentWorkspace().archiveTask(id, revision))
  ipcMain.handle('task:restore', (_event, id: string) => currentWorkspace().restoreTask(id))
  ipcMain.handle('entity:merge', (_event, source: string, target: string) => currentWorkspace().mergeEntities(source, target))
  ipcMain.handle('entity:unmerge', (_event, source: string, reason: string) => currentWorkspace().unmergeEntities(source, reason))
  ipcMain.handle('identity:distinct', (_event, left: string, right: string) => currentWorkspace().markDistinctEntities(left, right))
  ipcMain.handle('identity:undo', (_event, id: string) => currentWorkspace().undoIdentityDecision(id))
  recentWorkspaces = new RecentWorkspaces(join(app.getPath('userData'), 'recent-workspaces.json'))
  if (background && process.platform === 'darwin') app.setActivationPolicy('accessory')
  const selected = process.argv.find((argument) => argument.startsWith('--workspace='))?.slice('--workspace='.length)
  if (selected) {
    try { await openWorkspace(selected) }
    catch (error) { dialog.showErrorBox('Could not open workspace', String(error)) }
  }
  Menu.setApplicationMenu(applicationMenu())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('will-quit', () => {
  conversationAbort?.abort()
  indexAbort?.abort()
  documentAbort?.abort()
  if (indexTimer) clearTimeout(indexTimer)
  if (documentTimer) clearTimeout(documentTimer)
  void watcher?.close()
  workspace?.close()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
