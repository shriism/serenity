import { contextBridge, ipcRenderer } from 'electron'
import type { SerenityAPI } from '../shared/types'

const api: SerenityAPI = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  refresh: () => ipcRenderer.invoke('workspace:refresh'),
  saveEntity: (entity) => ipcRenderer.invoke('entity:save', entity),
  addClaim: (claim) => ipcRenderer.invoke('claim:add', claim),
  importDocuments: () => ipcRenderer.invoke('document:import'),
  search: (query) => ipcRenderer.invoke('workspace:search', query),
  sendMessage: (input) => ipcRenderer.invoke('conversation:send', input),
  resolveProposal: (id, accept) => ipcRenderer.invoke('proposal:resolve', id, accept),
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id),
  credentialStatus: () => ipcRenderer.invoke('credential:status'),
  saveCredential: (provider, key) => ipcRenderer.invoke('credential:save', provider, key),
  onWorkspaceChange: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('workspace:changed', listener)
    return () => ipcRenderer.removeListener('workspace:changed', listener)
  }
}

contextBridge.exposeInMainWorld('serenity', api)
