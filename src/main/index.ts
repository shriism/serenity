import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import chokidar, { type FSWatcher } from 'chokidar'
import { Workspace } from './workspace'
import { sendMessage } from './conversation'
import { credentialStatus, saveCredential } from './credentials'
import { semanticSearch } from './semantic'
import { buildSemanticIndex, rankSemanticIndex } from './semantic-index'
import { askProvider } from './providers'
import { analyzeChangedDocument } from './document-analysis'
import { basename, dirname } from 'node:path'
import type { Autonomy, CalendarEvent, Claim, Entity, Provider, TaskItem } from '../shared/types'
import type { ModuleId } from '../shared/modules'

let window: BrowserWindow | null = null
let workspace: Workspace | null = null
let watcher: FSWatcher | null = null
let activeRequests = 0
let indexTimer: ReturnType<typeof setTimeout> | null = null
let indexRunning = false
let indexPending = false
const pendingDocuments = new Set<string>()
let documentTimer: ReturnType<typeof setTimeout> | null = null
let documentsRunning = false

async function withActiveRequest<T>(work: () => Promise<T>): Promise<T> {
  activeRequests++
  try { return await work() }
  finally { activeRequests-- }
}

function currentWorkspace(): Workspace {
  if (!workspace) throw new Error('Choose a workspace to continue.')
  return workspace
}

function scheduleSemanticIndex(target: Workspace): void {
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = setTimeout(() => {
    indexTimer = null
    if (workspace !== target) return
    if (indexRunning) { indexPending = true; return }
    indexRunning = true
    void withActiveRequest(() => buildSemanticIndex(target, askProvider)).then(() => {
      window?.webContents.send('workspace:changed')
    }).catch((error) => {
      window?.webContents.send('semantic:index-error', String(error))
    }).finally(() => {
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
          try {
            await withActiveRequest(() => analyzeChangedDocument(target, name, sendMessage))
            window?.webContents.send('workspace:changed')
          } catch (error) { window?.webContents.send('semantic:index-error', `Document ${name}: ${String(error)}`) }
        }
      } finally {
        documentsRunning = false
        if (pendingDocuments.size && workspace === target) queueDocumentAnalysis(target, pendingDocuments.values().next().value!)
      }
    })()
  }, 1200)
}

async function openWorkspace(path: string): Promise<ReturnType<Workspace['snapshot']>> {
  if (indexTimer) clearTimeout(indexTimer)
  if (documentTimer) clearTimeout(documentTimer)
  pendingDocuments.clear()
  await watcher?.close()
  workspace?.close()
  const next = new Workspace(path)
  await next.initialize()
  workspace = next
  watcher = chokidar.watch(next.directories, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 } })
  watcher.on('all', (event, changedPath) => {
    next.markDirty()
    window?.webContents.send('workspace:changed')
    scheduleSemanticIndex(next)
    if ((event === 'add' || event === 'change') && dirname(changedPath) === next.directories[2]) queueDocumentAnalysis(next, basename(changedPath))
  })
  scheduleSemanticIndex(next)
  return next.snapshot()
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Serenity',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.on('closed', () => { window = null })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('workspace:choose', async () => {
    if (activeRequests) throw new Error('Wait for the current AI request before switching workspaces.')
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a Serenity workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return openWorkspace(result.filePaths[0])
  })
  ipcMain.handle('workspace:refresh', () => { workspace?.markDirty(); return workspace?.snapshot() ?? null })
  ipcMain.handle('entity:save', (_event, entity: Entity) => currentWorkspace().saveEntity(entity))
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
  ipcMain.handle('workspace:search', (_event, query: string) => currentWorkspace().search(query))
  ipcMain.handle('workspace:semantic-search', (_event, query: string, provider: Provider) => withActiveRequest(() => semanticSearch(currentWorkspace(), query, provider)))
  ipcMain.handle('workspace:cached-semantic-search', (_event, query: string) => rankSemanticIndex(currentWorkspace(), query))
  ipcMain.handle('conversation:send', (_event, input: { conversationId?: string; text: string; provider: Provider; autonomy: Autonomy; retained: boolean }) => withActiveRequest(() => sendMessage(currentWorkspace(), input)))
  ipcMain.handle('proposal:resolve', (_event, id: string, accept: boolean) => currentWorkspace().resolveProposal(id, accept))
  ipcMain.handle('conversation:delete', (_event, id: string) => currentWorkspace().deleteConversation(id))
  ipcMain.handle('credential:status', () => credentialStatus())
  ipcMain.handle('credential:save', async (_event, provider: Provider, key: string) => {
    await saveCredential(provider, key)
    return credentialStatus()
  })
  ipcMain.handle('module:set', async (_event, id: ModuleId, enabled: boolean) => {
    const selected = currentWorkspace()
    const snapshot = await selected.setModule(id, enabled)
    if (id === 'semanticIndex' && enabled) scheduleSemanticIndex(selected)
    return snapshot
  })
  ipcMain.handle('semantic:provider', async (_event, provider: Provider) => {
    const selected = currentWorkspace()
    const snapshot = await selected.setSemanticProvider(provider)
    if (snapshot.modules.semanticIndex) scheduleSemanticIndex(selected)
    return snapshot
  })
  ipcMain.handle('calendar:save', (_event, item: CalendarEvent) => currentWorkspace().saveEvent(item))
  ipcMain.handle('task:save', (_event, item: TaskItem) => currentWorkspace().saveTask(item))
  ipcMain.handle('entity:merge', (_event, source: string, target: string) => currentWorkspace().mergeEntities(source, target))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { if (indexTimer) clearTimeout(indexTimer); if (documentTimer) clearTimeout(documentTimer); void watcher?.close(); workspace?.close() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
