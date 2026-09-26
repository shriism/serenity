import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import chokidar, { type FSWatcher } from 'chokidar'
import { Workspace } from './workspace'
import { sendMessage } from './conversation'
import { credentialStatus, saveCredential } from './credentials'
import { semanticSearch } from './semantic'
import { buildSemanticIndex, rankSemanticIndex } from './semantic-index'
import { askProvider } from './providers'
import { analyzeChangedDocument } from './document-analysis'
import { extractDocument } from './documents'
import { basename, dirname, join, sep } from 'node:path'
import type { Autonomy, CalendarEvent, Claim, Entity, Provider, ReadScope, TaskItem, WorkflowPermissions, WorkbenchSession, WorkspacePage, WorkspaceSnapshot } from '../shared/types'
import type { ModuleId } from '../shared/modules'

let window: BrowserWindow | null = null
let workspace: Workspace | null = null
let watcher: FSWatcher | null = null
let editorDirty = false
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

async function openWorkspace(path: string): Promise<WorkspaceSnapshot> {
  if (indexTimer) clearTimeout(indexTimer)
  if (documentTimer) clearTimeout(documentTimer)
  pendingDocuments.clear()
  await watcher?.close()
  workspace?.close()
  const next = new Workspace(path)
  await next.initialize()
  workspace = next
  const settingsDirectory = join(next.path, '.serenity')
  watcher = chokidar.watch([...next.directories.slice(0, 8), next.pagesDirectory, join(next.path, 'archive'), settingsDirectory], {
    ignoreInitial: true,
    ignored: (watchedPath) => watchedPath.startsWith(`${settingsDirectory}${sep}`) &&
      !['modules.yaml', 'semantic-provider.yaml', 'workbench.yaml'].includes(basename(watchedPath)),
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 }
  })
  watcher.on('all', (event, changedPath) => {
    next.markDirty()
    if (dirname(changedPath) === settingsDirectory) {
      if (basename(changedPath) === 'workbench.yaml') { window?.webContents.send('workspace:changed'); return }
      void next.snapshot().then((snapshot) => {
        if (basename(changedPath) === 'semantic-provider.yaml' || !snapshot.modules.semanticIndex) pauseBackgroundIndex()
        if (snapshot.modules.semanticIndex) scheduleSemanticIndex(next)
        if (!snapshot.modules.documentAnalysis) pauseDocumentAnalysis()
        window?.webContents.send('workspace:changed')
      }).catch((error) => window?.webContents.send('semantic:index-error', String(error)))
      return
    }
    window?.webContents.send('workspace:changed')
    scheduleSemanticIndex(next)
    if ((event === 'add' || event === 'change') && dirname(changedPath) === next.directories[2]) queueDocumentAnalysis(next, basename(changedPath))
  })
  scheduleSemanticIndex(next)
  return next.snapshot()
}

// `--background` runs without taking focus or showing a window, e.g. for automated checks while someone keeps working.
const background = process.argv.includes('--background')

function createWindow(): void {
  closeApproved = false
  window = new BrowserWindow({
    show: !background,
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Serenity',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !background
    }
  })
  window.on('closed', () => { window = null; closeApproved = false })
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

app.whenReady().then(async () => {
  ipcMain.on('editor:dirty', (_event, dirty: unknown) => { editorDirty = dirty === true })
  ipcMain.handle('workspace:choose', async () => {
    if (activeRequests) throw new Error('Wait for the current AI request before switching workspaces.')
    if (editorDirty && window) {
      const { response } = await dialog.showMessageBox(window, {
        type: 'question', title: 'Unsaved changes', message: 'Discard unsaved entity edits before changing workspaces?',
        buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0
      })
      if (response !== 1) return null
    }
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a Serenity workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const snapshot = await openWorkspace(result.filePaths[0])
    editorDirty = false
    return snapshot
  })
  ipcMain.handle('workspace:open-folder', async () => {
    const error = await shell.openPath(currentWorkspace().path)
    if (error) throw new Error(error)
  })
  ipcMain.handle('workspace:refresh', () => { workspace?.markDirty(); return workspace?.snapshot() ?? null })
  ipcMain.handle('entity:save', (_event, entity: Entity) => currentWorkspace().saveEntity(entity))
  ipcMain.handle('page:save', (_event, page: Pick<WorkspacePage, 'id' | 'path' | 'text' | 'revision'>) => currentWorkspace().savePage(page))
  ipcMain.handle('page:create', () => currentWorkspace().createPage())
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
  ipcMain.handle('task:save', (_event, item: TaskItem) => currentWorkspace().saveTask(item))
  ipcMain.handle('calendar:archive', (_event, id: string, revision: string) => currentWorkspace().archiveEvent(id, revision))
  ipcMain.handle('calendar:restore', (_event, id: string) => currentWorkspace().restoreEvent(id))
  ipcMain.handle('task:archive', (_event, id: string, revision: string) => currentWorkspace().archiveTask(id, revision))
  ipcMain.handle('task:restore', (_event, id: string) => currentWorkspace().restoreTask(id))
  ipcMain.handle('entity:merge', (_event, source: string, target: string) => currentWorkspace().mergeEntities(source, target))
  ipcMain.handle('entity:unmerge', (_event, source: string, reason: string) => currentWorkspace().unmergeEntities(source, reason))
  if (background && process.platform === 'darwin') app.setActivationPolicy('accessory')
  const selected = process.argv.find((argument) => argument.startsWith('--workspace='))?.slice('--workspace='.length)
  if (selected) {
    try { await openWorkspace(selected) }
    catch (error) { dialog.showErrorBox('Could not open workspace', String(error)) }
  }
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
