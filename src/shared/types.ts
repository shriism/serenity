import type { ModuleId } from './modules'

export interface Entity {
  id: string
  title: string
  type: string
  body: string
  revision?: string
  source?: string
  origin?: 'human' | 'ai-statement' | 'ai-inference'
}

export interface Claim {
  id: string
  subject: string
  key: string
  value: string
  source: string
  origin: 'human' | 'ai-statement' | 'ai-inference'
  status: 'confirmed' | 'proposed' | 'retracted'
  recordedAt: string
  mergedFrom?: string
  retractedAt?: string
  retractionReason?: string
  confidence?: number
  isCurrent?: boolean
}

export interface ClaimResolution {
  id: string
  subject: string
  key: string
  currentClaimId: string | null
  recordedAt: string
  reason: string
  sequence?: number
}

export interface WorkspaceSnapshot {
  path: string
  entities: Entity[]
  claims: Claim[]
  resolutions: ClaimResolution[]
  conversations: Conversation[]
  proposals: Proposal[]
  documents: DocumentInfo[]
  modules: Record<ModuleId, boolean>
  events: CalendarEvent[]
  tasks: TaskItem[]
  merges: MergeRecord[]
  archivedEntities: Entity[]
  semanticProvider: Provider
  semanticIndex: { generatedAt: string; count: number } | null
  providerActivity: ProviderActivity[]
  errors: string[]
}

export interface ProviderActivity {
  id: string
  provider: Provider
  operation: 'conversation' | 'semantic-search' | 'background-index' | 'document-analysis'
  refs: string[]
  promptCharacters: number
  promptChecksum: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'completed' | 'failed'
  error?: string
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
  source?: string
  origin?: 'human' | 'ai-statement' | 'ai-inference'
  recordedAt?: string
}

export interface TaskItem {
  id: string
  title: string
  due?: string
  completed: boolean
  notes: string
  relatedEntityIds: string[]
  revision?: string
  source?: string
  origin?: 'human' | 'ai-statement' | 'ai-inference'
  recordedAt?: string
}

export type Provider = 'copilot' | 'codex' | 'claude'
export type Autonomy = 'ask' | 'propose' | 'autonomous'

export interface WorkflowPermissions {
  claims: boolean
  entities: boolean
  tasks: boolean
  events: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  provider?: Provider
  recordedAt: string
  sharedContext?: SharedContext[]
}

export interface SharedContext {
  mode: 'full' | 'retrieved'
  records: { ref: string; title: string; startCharacter: number; sentCharacters: number; totalCharacters: number; checksum: string }[]
  availableCount: number
  catalogShown: number
  sentCharacters: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  retained: boolean
  autonomy?: Autonomy
  permissions?: WorkflowPermissions
  revision?: string
}

export interface ProposalBase {
  id: string
  provider: Provider
  conversationId: string
  status: 'pending' | 'accepted' | 'rejected'
  recordedAt: string
  reviewReason?: string
}

export type Proposal = ProposalBase & (
  | { kind: 'claim'; subject: string; key: string; value: string; source: string; origin: 'ai-statement' | 'ai-inference'; confidence?: number }
  | { kind: 'entity'; title: string; type: string; body: string; source: string; origin: 'ai-statement' | 'ai-inference' }
  | { kind: 'task'; title: string; due?: string; notes: string; relatedEntityIds: string[]; source: string; origin: 'ai-statement' | 'ai-inference' }
  | { kind: 'event'; title: string; start: string; end?: string; notes: string; relatedEntityIds: string[]; source: string; origin: 'ai-statement' | 'ai-inference' }
)

export interface DocumentInfo {
  name: string
  size: number
}

export interface SearchResult {
  kind: 'entity' | 'claim' | 'document' | 'task' | 'event'
  id: string
  title: string
  detail: string
}

export interface SerenityAPI {
  chooseWorkspace(): Promise<WorkspaceSnapshot | null>
  refresh(): Promise<WorkspaceSnapshot | null>
  saveEntity(entity: Entity): Promise<WorkspaceSnapshot>
  addClaim(claim: Pick<Claim, 'subject' | 'key' | 'value' | 'source'>): Promise<WorkspaceSnapshot>
  retractClaim(id: string, reason: string): Promise<WorkspaceSnapshot>
  setCurrentClaim(id: string, reason: string): Promise<WorkspaceSnapshot>
  clearCurrentClaim(subject: string, key: string): Promise<WorkspaceSnapshot>
  importDocuments(): Promise<WorkspaceSnapshot | null>
  search(query: string): Promise<SearchResult[]>
  semanticSearch(query: string, provider: Provider): Promise<SearchResult[]>
  searchSemanticIndex(query: string): Promise<SearchResult[]>
  sendMessage(input: { conversationId?: string; text: string; provider: Provider; autonomy: Autonomy; retained: boolean; permissions?: WorkflowPermissions }): Promise<WorkspaceSnapshot>
  updateConversationSettings(id: string, settings: { autonomy: Autonomy; permissions: WorkflowPermissions; retained: boolean }): Promise<WorkspaceSnapshot>
  resolveProposal(id: string, accept: boolean): Promise<WorkspaceSnapshot>
  deleteConversation(id: string): Promise<WorkspaceSnapshot>
  credentialStatus(): Promise<Record<Provider, boolean>>
  saveCredential(provider: Provider, key: string): Promise<Record<Provider, boolean>>
  setModule(id: ModuleId, enabled: boolean): Promise<WorkspaceSnapshot>
  saveEvent(event: CalendarEvent): Promise<WorkspaceSnapshot>
  saveTask(task: TaskItem): Promise<WorkspaceSnapshot>
  mergeEntities(source: string, target: string): Promise<WorkspaceSnapshot>
  setSemanticProvider(provider: Provider): Promise<WorkspaceSnapshot>
  onIndexError(callback: (message: string) => void): () => void
  onWorkspaceChange(callback: () => void): () => void
}
