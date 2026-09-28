import { useState, type FormEvent } from 'react'
import type { Autonomy, Conversation, Provider, ReadScope, WorkflowPermissions, WorkspaceSnapshot } from '../../shared/types'
import { defaultReadScope, defaultWorkflowPermissions } from '../../shared/workflow'

const freshScope = (): ReadScope => ({ ...defaultReadScope, entityIds: [], documentNames: [] })

/** What the provider is told the person is looking at; each list is filtered by read scope in the main process. */
export interface AssistantContext { activeRef?: string; visibleRefs: string[]; openRefs: string[] }

/** The assistant's conversation and workflow state, and the operations that send, cancel, and manage conversations. */
export function useAssistant({ workspace, setWorkspace, refresh, setError, contextRefs, reveal }: {
  workspace: WorkspaceSnapshot | null
  setWorkspace(snapshot: WorkspaceSnapshot): void
  refresh(): Promise<void>
  setError(message: string): void
  /** Read at send time, so the focused and visible panes are current. */
  contextRefs(): AssistantContext
  /** Shows the assistant panel; `returnToSidebar` also leaves the expanded, full-width mode. */
  reveal(returnToSidebar: boolean): void
}) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>('copilot')
  const [autonomy, setAutonomy] = useState<Autonomy>('propose')
  const [retained, setRetained] = useState(true)
  const [permissions, setPermissions] = useState<WorkflowPermissions>({ ...defaultWorkflowPermissions })
  const [readScope, setReadScope] = useState<ReadScope>(freshScope)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  /** Adopts a conversation's settings, or the defaults for a new one. */
  function restoreConversation(item: Conversation | undefined): void {
    setConversationId(item?.id ?? null)
    setRetained(item?.retained ?? true)
    setAutonomy(item?.autonomy ?? 'propose')
    setPermissions(item?.permissions ?? { ...defaultWorkflowPermissions })
    setReadScope(item?.readScope ?? freshScope())
  }

  /** Starts a new conversation; with `scope`, it may read only those entities and documents. */
  function startConversation(prompt = '', scope?: Pick<ReadScope, 'entityIds' | 'documentNames'>): void {
    if (message.trim() && !window.confirm('Discard your unsent message?')) return
    restoreConversation(undefined)
    if (scope) setReadScope({ ...freshScope(), mode: 'selected', entityIds: scope.entityIds, documentNames: scope.documentNames })
    setMessage(prompt)
    reveal(true)
  }

  function selectConversation(item: Conversation): void {
    if (busy || (message.trim() && item.id !== conversationId && !window.confirm('Discard your unsent message?'))) return
    restoreConversation(item)
    setMessage('')
    reveal(false)
  }

  async function sendMessage(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!message.trim() || busy || !workspace) return
    if (autonomy === 'ask' && !window.confirm(`Allow ${provider} to read this workspace for this request? No knowledge changes will be saved without separate approval.`)) return
    setBusy(true)
    try {
      const next = await window.serenity.sendMessage({ conversationId: conversationId ?? undefined, text: message, provider, autonomy, retained, permissions, readScope, ...contextRefs() })
      if (!conversationId) setConversationId(next.conversations.find((item) => !workspace.conversations.some((old) => old.id === item.id))?.id ?? null)
      setWorkspace(next)
      setMessage('')
      setError('')
    } catch (cause) {
      await refresh()
      setError(String(cause))
    } finally { setBusy(false) }
  }

  async function cancelMessage(): Promise<void> {
    try { await window.serenity.cancelMessage() }
    catch (cause) { setError(String(cause)) }
  }

  async function deleteConversation(targetId = conversationId ?? ''): Promise<void> {
    if (!targetId || !window.confirm('Delete this conversation and the knowledge created from it? This cannot be undone.')) return
    try {
      setWorkspace(await window.serenity.deleteConversation(targetId))
      if (targetId === conversationId) setConversationId(null)
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  async function saveWorkflowSettings(): Promise<void> {
    if (!conversationId) return
    try {
      setWorkspace(await window.serenity.updateConversationSettings(conversationId, { autonomy, permissions, retained, readScope }))
      setError('')
    } catch (cause) { setError(String(cause)) }
  }

  return {
    conversationId, conversation: workspace?.conversations.find((item) => item.id === conversationId),
    provider, setProvider, autonomy, setAutonomy, retained, setRetained, permissions, setPermissions, readScope, setReadScope,
    message, setMessage, busy,
    restoreConversation, startConversation, selectConversation, sendMessage, cancelMessage, deleteConversation, saveWorkflowSettings
  }
}
