import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import chokidar, { type FSWatcher } from 'chokidar'
import { Workspace } from './workspace'
import { sendMessage } from './conversation'
import { credentialStatus, saveCredential } from './credentials'
import type { Autonomy, Claim, Entity, Provider } from '../shared/types'

let window: BrowserWindow | null = null
let workspace: Workspace | null = null
let watcher: FSWatcher | null = null

function currentWorkspace(): Workspace {
  if (!workspace) throw new Error('Choose a workspace to continue.')
  return workspace
}

async function openWorkspace(path: string): Promise<ReturnType<Workspace['snapshot']>> {
  await watcher?.close()
  workspace?.close()
  const next = new Workspace(path)
  await next.initialize()
  workspace = next
  watcher = chokidar.watch(next.directories, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 } })
  watcher.on('all', () => { next.markDirty(); window?.webContents.send('workspace:changed') })
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
  ipcMain.handle('document:import', async () => {
    const files = await dialog.showOpenDialog(window!, { title: 'Import documents', properties: ['openFile', 'multiSelections'] })
    if (files.canceled) return null
    for (const path of files.filePaths) await currentWorkspace().importDocument(path)
    return currentWorkspace().snapshot()
  })
  ipcMain.handle('workspace:search', (_event, query: string) => currentWorkspace().search(query))
  ipcMain.handle('conversation:send', (_event, input: { conversationId?: string; text: string; provider: Provider; autonomy: Autonomy; retained: boolean }) => sendMessage(currentWorkspace(), input))
  ipcMain.handle('proposal:resolve', (_event, id: string, accept: boolean) => currentWorkspace().resolveProposal(id, accept))
  ipcMain.handle('conversation:delete', (_event, id: string) => currentWorkspace().deleteConversation(id))
  ipcMain.handle('credential:status', () => credentialStatus())
  ipcMain.handle('credential:save', async (_event, provider: Provider, key: string) => {
    await saveCredential(provider, key)
    return credentialStatus()
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { void watcher?.close(); workspace?.close() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
