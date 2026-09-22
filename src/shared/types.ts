import type { ModuleId } from './modules'

export interface Entity {
  id: string
  title: string
  type: string
  body: string
  revision?: string
}

export interface Claim {
  id: string
  subject: string
  key: string
  value: string
  source: string
  origin: 'human' | 'ai-statement' | 'ai-inference'
  status: 'confirmed' | 'proposed'
  recordedAt: string
  mergedFrom?: string
}

export interface WorkspaceSnapshot {
  path: string
  entities: Entity[]
  claims: Claim[]
  conversations: Conversation[]
  proposals: Proposal[]
  documents: DocumentInfo[]
  modules: Record<ModuleId, boolean>
  events: CalendarEvent[]
  tasks: TaskItem[]
  merges: MergeRecord[]
  errors: string[]
}

export interface MergeRecord {
  id: string
  target: string
  title: string
  recordedAt: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end?: string
  notes: string
  relatedEntityIds: string[]
  revision?: string
}

export interface TaskItem {
  id: string
  title: string
  due?: string
  completed: boolean
  notes: string
  relatedEntityIds: string[]
  revision?: string
}

export type Provider = 'copilot' | 'codex' | 'claude'
export type Autonomy = 'ask' | 'propose' | 'autonomous'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  provider?: Provider
  recordedAt: string
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  retained: boolean
  autonomy?: Autonomy
}

export interface Proposal {
  id: string
  subject: string
  key: string
  value: string
  source: string
  origin: 'ai-statement' | 'ai-inference'
  provider: Provider
  conversationId: string
  status: 'pending' | 'accepted' | 'rejected'
  recordedAt: string
}

export interface DocumentInfo {
  name: string
  size: number
}

export interface SearchResult {
  kind: 'entity' | 'claim' | 'document'
  id: string
  title: string
  detail: string
}

export interface SerenityAPI {
  chooseWorkspace(): Promise<WorkspaceSnapshot | null>
  refresh(): Promise<WorkspaceSnapshot | null>
  saveEntity(entity: Entity): Promise<WorkspaceSnapshot>
  addClaim(claim: Pick<Claim, 'subject' | 'key' | 'value' | 'source'>): Promise<WorkspaceSnapshot>
  importDocuments(): Promise<WorkspaceSnapshot | null>
  search(query: string): Promise<SearchResult[]>
  semanticSearch(query: string, provider: Provider): Promise<SearchResult[]>
  sendMessage(input: { conversationId?: string; text: string; provider: Provider; autonomy: Autonomy; retained: boolean }): Promise<WorkspaceSnapshot>
  resolveProposal(id: string, accept: boolean): Promise<WorkspaceSnapshot>
  deleteConversation(id: string): Promise<WorkspaceSnapshot>
  credentialStatus(): Promise<Record<Provider, boolean>>
  saveCredential(provider: Provider, key: string): Promise<Record<Provider, boolean>>
  setModule(id: ModuleId, enabled: boolean): Promise<WorkspaceSnapshot>
  saveEvent(event: CalendarEvent): Promise<WorkspaceSnapshot>
  saveTask(task: TaskItem): Promise<WorkspaceSnapshot>
  mergeEntities(source: string, target: string): Promise<WorkspaceSnapshot>
  onWorkspaceChange(callback: () => void): () => void
}
