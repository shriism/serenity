import { contextBridge, ipcRenderer } from 'electron'
import type { SerenityAPI } from '../shared/types'

const api: SerenityAPI = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  recentWorkspaces: () => ipcRenderer.invoke('workspace:recent'),
  openRecentWorkspace: (path) => ipcRenderer.invoke('workspace:open-recent', path),
  forgetRecentWorkspace: (path) => ipcRenderer.invoke('workspace:forget-recent', path),
  openWorkspaceFolder: () => ipcRenderer.invoke('workspace:open-folder'),
  openExternal: (url) => ipcRenderer.invoke('link:open-external', url),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setEditorDirty: (dirty) => ipcRenderer.send('editor:dirty', dirty),
  setWindowTheme: (theme) => ipcRenderer.send('window:theme', theme),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  refresh: () => ipcRenderer.invoke('workspace:refresh'),
  saveEntity: (entity) => ipcRenderer.invoke('entity:save', entity),
  savePage: (page) => ipcRenderer.invoke('page:save', page),
  renameWikilinks: (from, to, uris) => ipcRenderer.invoke('wikilinks:rename', from, to, uris),
  createPage: () => ipcRenderer.invoke('page:create'),
  loadSession: () => ipcRenderer.invoke('workspace:session:load'),
  saveSession: (session) => ipcRenderer.invoke('workspace:session:save', session),
  addClaim: (claim) => ipcRenderer.invoke('claim:add', claim),
  retractClaim: (id, reason) => ipcRenderer.invoke('claim:retract', id, reason),
  setCurrentClaim: (id, reason) => ipcRenderer.invoke('claim:current', id, reason),
  clearCurrentClaim: (subject, key) => ipcRenderer.invoke('claim:current-clear', subject, key),
  importDocuments: () => ipcRenderer.invoke('document:import'),
  openDocument: (name) => ipcRenderer.invoke('document:open', name),
  readDocument: (name) => ipcRenderer.invoke('document:read', name),
  search: (query) => ipcRenderer.invoke('workspace:search', query),
  semanticSearch: (query, provider) => ipcRenderer.invoke('workspace:semantic-search', query, provider),
  searchSemanticIndex: (query) => ipcRenderer.invoke('workspace:cached-semantic-search', query),
  sendMessage: (input) => ipcRenderer.invoke('conversation:send', input),
  cancelMessage: () => ipcRenderer.invoke('conversation:cancel'),
  updateConversationSettings: (id, settings) => ipcRenderer.invoke('conversation:settings', id, settings),
  resolveProposal: (id, accept) => ipcRenderer.invoke('proposal:resolve', id, accept),
  attachEntityProposal: (proposalId, entityId) => ipcRenderer.invoke('proposal:attach-entity', proposalId, entityId),
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id),
  credentialStatus: () => ipcRenderer.invoke('credential:status'),
  saveCredential: (provider, key) => ipcRenderer.invoke('credential:save', provider, key),
  setModule: (id, enabled) => ipcRenderer.invoke('module:set', id, enabled),
  saveEvent: (event) => ipcRenderer.invoke('calendar:save', event),
  saveTask: (task) => ipcRenderer.invoke('task:save', task),
  archiveEvent: (id, revision) => ipcRenderer.invoke('calendar:archive', id, revision),
  restoreEvent: (id) => ipcRenderer.invoke('calendar:restore', id),
  archiveTask: (id, revision) => ipcRenderer.invoke('task:archive', id, revision),
  restoreTask: (id) => ipcRenderer.invoke('task:restore', id),
  mergeEntities: (source, target) => ipcRenderer.invoke('entity:merge', source, target),
  unmergeEntities: (source, reason) => ipcRenderer.invoke('entity:unmerge', source, reason),
  markDistinctEntities: (left, right) => ipcRenderer.invoke('identity:distinct', left, right),
  undoIdentityDecision: (id) => ipcRenderer.invoke('identity:undo', id),
  setSemanticProvider: (provider) => ipcRenderer.invoke('semantic:provider', provider),
  onMenuCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  onIndexError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('semantic:index-error', listener)
    return () => ipcRenderer.removeListener('semantic:index-error', listener)
  },
  onWorkspaceChange: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('workspace:changed', listener)
    return () => ipcRenderer.removeListener('workspace:changed', listener)
  }
}

contextBridge.exposeInMainWorld('serenity', api)
