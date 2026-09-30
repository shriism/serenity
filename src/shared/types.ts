import type { ModuleId } from './modules'
import type { SessionLayout } from './layout'
import type { Citation } from './citations'

export interface Entity {
  id: string
  title: string
  type: string
  body: string
  revision?: string
  source?: string
  origin?: 'human' | 'ai-statement' | 'ai-inference'
  metadata?: Record<string, unknown>
  /** Set on entities moved to the archive on purpose, rather than merged into another. */
  archived?: boolean
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
  metadata?: Record<string, unknown>
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
  /** Increases with each snapshot of this workspace, in the order reading began, so late replies can be ignored. */
  generation: number
  pages: WorkspacePage[]
  workbench: WorkbenchConfig
  entities: Entity[]
  claims: Claim[]
  resolutions: ClaimResolution[]
  conversations: Conversation[]
  proposals: Proposal[]
  documents: DocumentInfo[]
  modules: Record<ModuleId, boolean>
  events: CalendarEvent[]
  archivedEvents: CalendarEvent[]
  tasks: TaskItem[]
  archivedTasks: TaskItem[]
  merges: MergeRecord[]
  mergeHistory: MergeRecord[]
  identityDecisions: IdentityDecision[]
  archivedEntities: Entity[]
  semanticProvider: Provider
  backgroundProviderNeedsChoice: boolean
  semanticIndex: { generatedAt: string; count: number; provider: Provider } | null
  providerActivity: ProviderActivity[]
  errors: string[]
}

export interface ProviderConnectionStatus {
  state: 'signed-in' | 'key-saved' | 'signed-out' | 'unavailable'
  account?: string
}

export interface WorkbenchConfig {
  homePage: string
  navigation: { group: string; commands: string[] }[]
  /** Command ID to chord (e.g. `Mod+Shift+K`), or null to remove a default binding. */
  keybindings?: Record<string, string | null>
}

/** Workspace-local UI state. The top-level view and URIs mirror the focused group for older readers. */
export interface WorkbenchSession {
  view: string
  activeUri?: string
  assistantUri?: string
  openUris: string[]
  layout?: SessionLayout
}

export interface WorkspacePage {
  id: string
  title: string
  path: string
  body: string
  text: string
  revision: string
}

export interface ProviderActivity {
  id: string
  conversationId?: string
  provider: string
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
  undoneAt?: string
  undoReason?: string
}

/** A human judgment that two active entity IDs refer to different identities; undo keeps the record. */
export interface IdentityDecision {
  version: 1
  id: string
  kind: 'distinct'
  left: string
  right: string
  recordedAt: string
  reason?: string
  undoneAt?: string
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
  metadata?: Record<string, unknown>
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
  metadata?: Record<string, unknown>
}

export type Provider = 'copilot' | 'codex'
export type Autonomy = 'ask' | 'propose' | 'autonomous'

export interface WorkflowPermissions {
  claims: boolean
  entities: boolean
  tasks: boolean
  events: boolean
}

export interface ReadScope {
  mode: 'workspace' | 'selected'
  entityIds: string[]
  documentNames: string[]
  includeOtherConversations: boolean
  includeCalendarAndTasks: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  provider?: string
  recordedAt: string
  sharedContext?: SharedContext[]
  /** Records the answer relies on, checked against the context actually sent. */
  citations?: Citation[]
}

export interface SharedContext {
  mode: 'full' | 'retrieved'
  records: { ref: string; title: string; startCharacter: number; sentCharacters: number; totalCharacters: number; checksum: string }[]
  availableCount: number
  catalogShown: number
  sentCharacters: number
  readScopeMode?: ReadScope['mode']
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  retained: boolean
  starred?: boolean
  autonomy?: Autonomy
  permissions?: WorkflowPermissions
  readScope?: ReadScope
  revision?: string
}

export interface ProposalBase {
  id: string
  provider: string
  conversationId: string
  status: 'pending' | 'accepted' | 'rejected'
  recordedAt: string
  reviewReason?: string
  resolvedInto?: string
  createdEntityId?: string
  createdResourceId?: string
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
  extractable: boolean
}

export interface SearchResult {
  kind: 'entity' | 'claim' | 'document' | 'task' | 'event' | 'page'
  id: string
  title: string
  detail: string
  /** Text around the match, with matched words between U+0001 and U+0002; absent when only the title matched. */
  excerpt?: string
}

export interface SerenityAPI {
  chooseWorkspace(): Promise<WorkspaceSnapshot | null>
  openWorkspaceFolder(): Promise<void>
  /** Opens an http(s) or mailto link in the system's default app; other schemes are refused. */
  openExternal(url: string): Promise<void>
  /** Versions for bug reports: the app, its Electron and Chromium runtime, and the operating system. */
  appInfo(): Promise<{ version: string; electron: string; chrome: string; platform: string }>
  setEditorDirty(dirty: boolean): void
  /** Workspaces opened on this device, newest first. */
  recentWorkspaces(): Promise<{ path: string; name: string; available: boolean }[]>
  /** Reopens a workspace from the recent list; null if the person chose to keep editing. */
  openRecentWorkspace(path: string): Promise<WorkspaceSnapshot | null>
  forgetRecentWorkspace(path: string): Promise<{ path: string; name: string; available: boolean }[]>
  /** Matches the system-drawn title bar controls to the app's appearance. */
  setWindowTheme(theme: 'dark' | 'light'): void
  isFullScreen(): Promise<boolean>
  onFullScreenChange(callback: (fullScreen: boolean) => void): () => void
  copyText(text: string): void
  /** Runs when a command is chosen from the application menu. */
  onMenuCommand(callback: (id: string) => void): () => void
  refresh(): Promise<WorkspaceSnapshot | null>
  saveEntity(entity: Entity): Promise<WorkspaceSnapshot>
  addClaim(claim: Pick<Claim, 'subject' | 'key' | 'value' | 'source'>): Promise<WorkspaceSnapshot>
  retractClaim(id: string, reason: string): Promise<WorkspaceSnapshot>
  setCurrentClaim(id: string, reason: string): Promise<WorkspaceSnapshot>
  clearCurrentClaim(subject: string, key: string): Promise<WorkspaceSnapshot>
  importDocuments(): Promise<WorkspaceSnapshot | null>
  openDocument(name: string): Promise<void>
  readDocument(name: string): Promise<string | null>
  savePage(page: Pick<WorkspacePage, 'id' | 'path' | 'text' | 'revision'>): Promise<WorkspaceSnapshot>
  createPage(): Promise<WorkspaceSnapshot>
  /** Moves a page to `archive/pages/`; the Home page cannot be archived. */
  archivePage(id: string, revision: string): Promise<WorkspaceSnapshot>
  /** A Markdown or plain-text document's text and revision, for editing. */
  readEditableDocument(name: string): Promise<{ text: string; revision: string }>
  saveDocumentText(name: string, text: string, revision: string): Promise<{ snapshot: WorkspaceSnapshot; revision: string }>
  /** Creates an empty Markdown document in `documents/`. */
  createDocument(): Promise<{ snapshot: WorkspaceSnapshot; name: string }>
  /** Sets a command's shortcut for this workspace: a chord, null for none, or undefined for the default. */
  setKeybinding(commandId: string, chord: string | null | undefined): Promise<WorkspaceSnapshot>
  /** Moves an entity and its facts to `archive/removed/`. */
  archiveEntity(id: string, revision: string): Promise<WorkspaceSnapshot>
  /** Moves an imported document to `archive/documents/`. */
  archiveDocument(name: string): Promise<WorkspaceSnapshot>
  renameWikilinks(from: string, to: string, uris: string[]): Promise<{ snapshot: WorkspaceSnapshot; count: number }>
  loadSession(): Promise<WorkbenchSession | null>
  saveSession(session: WorkbenchSession): Promise<void>
  search(query: string): Promise<SearchResult[]>
  semanticSearch(query: string, provider: Provider): Promise<SearchResult[]>
  searchSemanticIndex(query: string): Promise<SearchResult[]>
  sendMessage(input: { conversationId?: string; text: string; provider: Provider; autonomy: Autonomy; retained: boolean; permissions?: WorkflowPermissions; readScope?: ReadScope; activeRef?: string; visibleRefs?: string[]; openRefs?: string[] }): Promise<WorkspaceSnapshot>
  cancelMessage(): Promise<boolean>
  updateConversationSettings(id: string, settings: { autonomy: Autonomy; permissions: WorkflowPermissions; retained: boolean; readScope?: ReadScope }): Promise<WorkspaceSnapshot>
  resolveProposal(id: string, accept: boolean): Promise<WorkspaceSnapshot>
  attachEntityProposal(proposalId: string, entityId: string): Promise<WorkspaceSnapshot>
  deleteConversation(id: string): Promise<WorkspaceSnapshot>
  starConversation(id: string, starred: boolean): Promise<WorkspaceSnapshot>
  providerStatus(): Promise<Record<Provider, ProviderConnectionStatus>>
  saveCredential(provider: Provider, key: string): Promise<Record<Provider, ProviderConnectionStatus>>
  setModule(id: ModuleId, enabled: boolean): Promise<WorkspaceSnapshot>
  saveEvent(event: CalendarEvent): Promise<WorkspaceSnapshot>
  saveTask(task: TaskItem): Promise<WorkspaceSnapshot>
  archiveEvent(id: string, revision: string): Promise<WorkspaceSnapshot>
  restoreEvent(id: string): Promise<WorkspaceSnapshot>
  archiveTask(id: string, revision: string): Promise<WorkspaceSnapshot>
  restoreTask(id: string): Promise<WorkspaceSnapshot>
  mergeEntities(source: string, target: string): Promise<WorkspaceSnapshot>
  unmergeEntities(source: string, reason: string): Promise<WorkspaceSnapshot>
  markDistinctEntities(left: string, right: string): Promise<WorkspaceSnapshot>
  undoIdentityDecision(id: string): Promise<WorkspaceSnapshot>
  setSemanticProvider(provider: Provider): Promise<WorkspaceSnapshot>
  onIndexError(callback: (message: string) => void): () => void
  onWorkspaceChange(callback: () => void): () => void
}
