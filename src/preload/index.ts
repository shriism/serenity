import { contextBridge, ipcRenderer } from 'electron'
import type { SerenityAPI } from '../shared/types'

const api: SerenityAPI = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  refresh: () => ipcRenderer.invoke('workspace:refresh'),
  saveEntity: (entity) => ipcRenderer.invoke('entity:save', entity),
  addClaim: (claim) => ipcRenderer.invoke('claim:add', claim),
  importDocuments: () => ipcRenderer.invoke('document:import'),
  search: (query) => ipcRenderer.invoke('workspace:search', query),
  semanticSearch: (query, provider) => ipcRenderer.invoke('workspace:semantic-search', query, provider),
  sendMessage: (input) => ipcRenderer.invoke('conversation:send', input),
  resolveProposal: (id, accept) => ipcRenderer.invoke('proposal:resolve', id, accept),
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id),
  credentialStatus: () => ipcRenderer.invoke('credential:status'),
  saveCredential: (provider, key) => ipcRenderer.invoke('credential:save', provider, key),
  setModule: (id, enabled) => ipcRenderer.invoke('module:set', id, enabled),
  saveEvent: (event) => ipcRenderer.invoke('calendar:save', event),
  saveTask: (task) => ipcRenderer.invoke('task:save', task),
  mergeEntities: (source, target) => ipcRenderer.invoke('entity:merge', source, target),
  onWorkspaceChange: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('workspace:changed', listener)
    return () => ipcRenderer.removeListener('workspace:changed', listener)
  }
}

contextBridge.exposeInMainWorld('serenity', api)
