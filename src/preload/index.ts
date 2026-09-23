import { contextBridge, ipcRenderer } from 'electron'
import type { SerenityAPI } from '../shared/types'

const api: SerenityAPI = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  refresh: () => ipcRenderer.invoke('workspace:refresh'),
  saveEntity: (entity) => ipcRenderer.invoke('entity:save', entity),
  addClaim: (claim) => ipcRenderer.invoke('claim:add', claim),
  retractClaim: (id, reason) => ipcRenderer.invoke('claim:retract', id, reason),
  setCurrentClaim: (id, reason) => ipcRenderer.invoke('claim:current', id, reason),
  clearCurrentClaim: (subject, key) => ipcRenderer.invoke('claim:current-clear', subject, key),
  importDocuments: () => ipcRenderer.invoke('document:import'),
  search: (query) => ipcRenderer.invoke('workspace:search', query),
  semanticSearch: (query, provider) => ipcRenderer.invoke('workspace:semantic-search', query, provider),
  searchSemanticIndex: (query) => ipcRenderer.invoke('workspace:cached-semantic-search', query),
  sendMessage: (input) => ipcRenderer.invoke('conversation:send', input),
  cancelMessage: () => ipcRenderer.invoke('conversation:cancel'),
  updateConversationSettings: (id, settings) => ipcRenderer.invoke('conversation:settings', id, settings),
  resolveProposal: (id, accept) => ipcRenderer.invoke('proposal:resolve', id, accept),
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
  setSemanticProvider: (provider) => ipcRenderer.invoke('semantic:provider', provider),
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
