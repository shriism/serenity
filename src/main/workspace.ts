import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import YAML from 'yaml'
import { isProviderId } from '../shared/providers'
import type { Autonomy, CalendarEvent, Claim, ClaimResolution, Conversation, DocumentInfo, Entity, IdentityDecision, MergeRecord, Proposal, Provider, ProviderActivity, ReadScope, SearchResult, TaskItem, WorkflowPermissions, WorkbenchConfig, WorkbenchSession, WorkspacePage, WorkspaceSnapshot } from '../shared/types'
import { parseResourceUri, workspaceResources } from '../shared/resources'
import { modules, type ModuleId } from '../shared/modules'
import { defaultHome } from '../shared/default-home'
import { defaultWorkbench } from '../shared/default-workbench'
import { normalizeKeybinding } from '../shared/keybindings'
import { isWorkbenchView, parseLayout, parseViewTabUri, tabViews, viewTabUri } from '../shared/layout'
import { rankSearchResults } from '../shared/search-rank'
import { renameWikilinks } from '../shared/wikilinks'
import { distinctRepresentatives } from '../shared/identity'
import { validateReadScope, validateWorkflowPermissions } from '../shared/workflow'
import { canExtractText, extractDocument } from './documents'

/** Providers earlier releases offered; their names still appear in saved settings and history. */
const retiredProviders: Record<string, string> = { codex: 'OpenAI Codex' }

/** Extra YAML fields as searchable words; records without any add nothing. */
const metadataText = (metadata: Record<string, unknown> | undefined): string => metadata && Object.keys(metadata).length ? JSON.stringify(metadata) : ''

/** Documents Serenity can edit as text; others are read through extraction or opened in their own app. */
const editableDocument = /\.(md|markdown|txt)$/i

/** `name` in `directory`, or, if taken, the same name with a number before its extension; earlier files are kept. */
async function freeName(directory: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let attempt = 1; ; attempt++) {
    const candidate = join(directory, attempt === 1 ? name : `${stem} ${attempt}${extension}`)
    try { await lstat(candidate) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate; throw error }
  }
}

/** A tab a session may restore: a workspace resource or a view such as Calendar. */
const isTabUri = (uri: string): boolean => parseResourceUri(uri) !== null || parseViewTabUri(uri) !== null

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extraProperties(value: Record<string, unknown>, known: readonly string[]): Record<string, unknown> | undefined {
  const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)))
  return Object.keys(extra).length ? extra : undefined
}

function updateYaml(text: string, changes: Record<string, unknown>): string {
  const document = YAML.parseDocument(text)
  if (document.errors.length) throw document.errors[0]
  const existing = document.toJS()
  if (!record(existing)) throw new Error('Invalid YAML mapping')
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      if (Object.hasOwn(existing, key)) document.delete(key)
    } else if (JSON.stringify(existing[key]) !== JSON.stringify(value)) document.set(key, value)
  }
  return document.toString()
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function id(value: unknown): string {
  const text = requiredText(value, 'ID')
  if (!/^[a-f0-9-]{36}$/i.test(text)) throw new Error('Invalid ID')
  return text
}

function checksum(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function date(value: unknown, name: string, optional = false): string | undefined {
  if (optional && (value === undefined || value === '')) return undefined
  const text = requiredText(value, name)
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text)
  if (!match) throw new Error(`Invalid ${name}`)
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const calendarDay = new Date(year, month - 1, day)
  if (calendarDay.getFullYear() !== year || calendarDay.getMonth() !== month - 1 || calendarDay.getDate() !== day ||
    (match[4] !== undefined && (hour > 23 || minute > 59))) throw new Error(`Invalid ${name}`)
  return text
}

function related(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Related entities must be a list')
  return value.map(id)
}

function parseEvent(data: unknown): CalendarEvent {
  if (!record(data)) throw new Error('Invalid event')
  return { id: id(data.id), title: requiredText(data.title, 'Title'), start: date(data.start, 'start date')!,
    end: date(data.end, 'end date', true), notes: typeof data.notes === 'string' ? data.notes : '',
    relatedEntityIds: related(data.relatedEntityIds ?? []),
    source: typeof data.source === 'string' ? data.source : undefined,
    origin: typeof data.origin === 'string' ? data.origin as CalendarEvent['origin'] : undefined,
    recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : undefined,
    metadata: extraProperties(data, ['id', 'title', 'start', 'end', 'notes', 'relatedEntityIds', 'source', 'origin', 'recordedAt']) }
}

function parseTask(data: unknown): TaskItem {
  if (!record(data)) throw new Error('Invalid task')
  return { id: id(data.id), title: requiredText(data.title, 'Title'), due: date(data.due, 'due date', true),
    completed: data.completed === true, notes: typeof data.notes === 'string' ? data.notes : '',
    relatedEntityIds: related(data.relatedEntityIds ?? []),
    source: typeof data.source === 'string' ? data.source : undefined,
    origin: typeof data.origin === 'string' ? data.origin as TaskItem['origin'] : undefined,
    recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : undefined,
    metadata: extraProperties(data, ['id', 'title', 'due', 'completed', 'notes', 'relatedEntityIds', 'source', 'origin', 'recordedAt']) }
}

function parseEntity(text: string): Entity {
  const match = frontmatter.exec(text)
  if (!match) throw new Error('Missing YAML frontmatter')
  const metadata: unknown = YAML.parse(match[1])
  if (!record(metadata)) throw new Error('Invalid entity metadata')
  return {
    id: id(metadata.id),
    title: requiredText(metadata.title, 'Title'),
    type: requiredText(metadata.type, 'Type'),
    body: text.slice(match[0].length),
    source: typeof metadata.source === 'string' ? metadata.source : undefined,
    origin: typeof metadata.origin === 'string' ? metadata.origin as Entity['origin'] : undefined,
    metadata: extraProperties(metadata, ['id', 'title', 'type', 'source', 'origin']),
    revision: checksum(text)
  }
}

function parsePage(text: string, path: string): WorkspacePage {
  const match = frontmatter.exec(text)
  if (!match) throw new Error('Page needs YAML frontmatter')
  const metadata: unknown = YAML.parse(match[1])
  if (!record(metadata) || metadata.kind !== 'page' || typeof metadata.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(metadata.id)) throw new Error('Invalid page metadata')
  return { id: metadata.id, title: requiredText(metadata.title, 'Title'), path,
    body: text.slice(match[0].length), text, revision: checksum(text) }
}

function parseClaim(text: string): Claim {
  const data: unknown = YAML.parse(text)
  if (!record(data)) throw new Error('Invalid claim')
  const origin = requiredText(data.origin, 'Origin')
  const status = requiredText(data.status, 'Status')
  if (!['human', 'ai-statement', 'ai-inference'].includes(origin)) throw new Error('Invalid origin')
  if (!['confirmed', 'proposed', 'retracted'].includes(status)) throw new Error('Invalid status')
  return {
    id: id(data.id),
    subject: id(data.subject),
    key: requiredText(data.key, 'Key'),
    value: requiredText(data.value, 'Value'),
    source: requiredText(data.source, 'Source'),
    origin: origin as Claim['origin'],
    status: status as Claim['status'],
    recordedAt: requiredText(data.recordedAt, 'Recorded at'),
    retractedAt: typeof data.retractedAt === 'string' ? data.retractedAt : undefined,
    retractionReason: typeof data.retractionReason === 'string' ? data.retractionReason : undefined,
    confidence: typeof data.confidence === 'number' && data.confidence >= 0 && data.confidence <= 1 ? data.confidence : undefined,
    metadata: extraProperties(data, ['id', 'subject', 'key', 'value', 'source', 'origin', 'status', 'recordedAt', 'retractedAt', 'retractionReason', 'confidence'])
  }
}

const parseYaml = (text: string): unknown => YAML.parse(text)

/** Runs file work a batch at a time, keeping results in order and staying well under open-file limits. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>, size = 64): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += size) results.push(...await Promise.all(items.slice(index, index + size).map(work)))
  return results
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, text, { flag: 'wx' })
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

export class Workspace {
  private ephemeral = new Map<string, Conversation>()
  private index: DatabaseSync | null = null
  private indexDirty = true
  private indexing: Promise<void> | null = null

  private snapshotGeneration = 0
  private identityMutation: Promise<void> = Promise.resolve()
  private sessionMutation: Promise<void> = Promise.resolve()
  private fileMutations = new Map<string, Promise<void>>()
  private rootRealpath: string | null = null
  private fileCache = new Map<string, { version: string; text: string; parsed: Map<string, unknown> }>()
  /** Files read since the cache was last swept; anything else is gone or unused and can be forgotten. */
  private readSinceSweep = new Set<string>()
  private extractedText = new Map<string, { version: string; text: string }>()
  private legacyTrashErrors: string[] = []

  constructor(readonly path: string, private readonly trashItem: (path: string) => Promise<void> = async () => {
    throw new Error('System Trash is unavailable outside the desktop application')
  }) {}

  private async withIdentityMutation<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.identityMutation
    let release!: () => void
    this.identityMutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await work() }
    finally { release() }
  }

  private async withFileMutation<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = this.fileMutations.get(path) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.fileMutations.set(path, current)
    await previous
    try { return await work() }
    finally {
      release()
      if (this.fileMutations.get(path) === current) this.fileMutations.delete(path)
    }
  }

  get directories(): string[] {
    return ['entities', 'claims', 'documents', 'conversations', 'proposals', 'calendar', 'tasks', 'resolutions', 'activity', 'identity-decisions'].map((name) => join(this.path, name))
  }

  get pagesDirectory(): string { return join(this.path, 'pages') }

  async initialize(): Promise<void> {
    await mkdir(this.path, { recursive: true })
    if ((await lstat(this.path)).isSymbolicLink()) throw new Error('Choose an actual workspace directory, not a linked directory')
    for (const directory of [...this.directories, this.pagesDirectory, join(this.path, '.serenity'),
      ...['entities', 'merges/history'].map((name) => join(this.path, 'archive', name))]) {
      let current = this.path
      for (const part of relative(this.path, directory).split(sep)) {
        current = join(current, part)
        try { await mkdir(current) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        const info = await lstat(current)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Workspace directory must be an actual directory: ${current}`)
      }
    }
    await this.verifyDirectories()
    try { await writeFile(join(this.pagesDirectory, 'Home.md'), defaultHome, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    try { await writeFile(join(this.path, '.serenity', 'workbench.yaml'), YAML.stringify(defaultWorkbench), { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }

  /** Moves removals made by older versions out of the workspace; merge history is deliberately excluded. */
  async migrateLegacyRemovals(): Promise<void> {
    const folders = ['trash/calendar', 'archive/calendar', 'archive/tasks', 'archive/pages', 'archive/documents',
      'archive/removed/entities', 'archive/removed/claims']
    this.legacyTrashErrors = []
    for (const folder of folders) {
      const directory = join(this.path, folder)
      let names: string[]
      try {
        const info = await lstat(directory)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Legacy removal folder is not a regular directory')
        names = await readdir(directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        this.legacyTrashErrors.push(`${folder}: ${String(error)}`)
        continue
      }
      for (const name of names) {
        const path = join(directory, name)
        try { await this.trashItem(await this.ownedFile(path)); this.markDirty() }
        catch (error) { this.legacyTrashErrors.push(`${folder}/${name}: ${String(error)}`) }
      }
      await rmdir(directory).catch(() => undefined)
    }
    for (const folder of ['trash', 'archive/removed']) await rmdir(join(this.path, folder)).catch(() => undefined)
  }

  private async verifyDirectories(): Promise<void> {
    for (const directory of [...this.directories, this.pagesDirectory, join(this.path, '.serenity'), join(this.path, 'archive'),
      ...['entities', 'merges', 'merges/history'].map((name) => join(this.path, 'archive', name))]) {
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Workspace directory must be an actual directory: ${directory}`)
    }
  }

  private async ownedStat(path: string): Promise<Stats> {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Workspace file must be a regular file inside this workspace')
    this.rootRealpath ??= await realpath(this.path)
    const within = relative(this.rootRealpath, await realpath(path))
    if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('File is outside this workspace')
    return info
  }

  private async ownedFile(path: string): Promise<string> { await this.ownedStat(path); return path }

  /**
   * Reads a workspace file, reusing the last read while its size, times, and inode are unchanged. Every snapshot
   * re-reads the whole workspace, so this keeps an edit from costing a full re-read of thousands of records.
   */
  private async readOwnedText(path: string): Promise<string> {
    const info = await this.ownedStat(path)
    this.readSinceSweep.add(path)
    const version = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`
    const cached = this.fileCache.get(path)
    if (cached?.version === version) return cached.text
    const text = await readFile(path, 'utf8')
    this.fileCache.set(path, { version, text, parsed: new Map() })
    return text
  }

  /** Reads and parses a file once per version. Each caller gets its own copy, since snapshots adjust records in place. */
  private async readOwnedParsed<T>(path: string, format: string, parse: (text: string) => T): Promise<{ text: string; value: T }> {
    const text = await this.readOwnedText(path)
    const entry = this.fileCache.get(path)
    if (!entry || entry.text !== text) return { text, value: parse(text) }
    if (!entry.parsed.has(format)) entry.parsed.set(format, parse(text))
    return { text, value: structuredClone(entry.parsed.get(format)) as T }
  }

  async readSettingsFile(name: 'semantic-index.yaml' | 'analyzed-documents.yaml' | 'session.yaml'): Promise<string> {
    await this.verifyDirectories()
    return this.readOwnedText(join(this.path, '.serenity', name))
  }

  async documentPath(name: string): Promise<string> {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || basename(name) !== name) throw new Error('Invalid document name')
    await this.verifyDirectories()
    return this.ownedFile(join(this.directories[2], name))
  }

  markDirty(): void { this.indexDirty = true }
  close(): void { this.index?.close(); this.index = null; this.indexDirty = true }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const generation = ++this.snapshotGeneration
    await this.verifyDirectories()
    const pages: WorkspacePage[] = []
    const entities: Entity[] = []
    const claims: Claim[] = []
    const resolutions: ClaimResolution[] = []
    const providerActivity: ProviderActivity[] = []
    const conversations: Conversation[] = []
    const proposals: Proposal[] = []
    const documents: DocumentInfo[] = []
    const events: CalendarEvent[] = []
    const archivedEvents: CalendarEvent[] = []
    const tasks: TaskItem[] = []
    const archivedTasks: TaskItem[] = []
    const merges: MergeRecord[] = []
    const mergeHistory: MergeRecord[] = []
    const identityDecisions: IdentityDecision[] = []
    const archivedEntities: Entity[] = []
    const errors: string[] = [...this.legacyTrashErrors]
    for (const name of (await readdir(this.pagesDirectory)).filter((item) => item.endsWith('.md')).sort()) {
      try {
        const path = `pages/${name}`
        const page = (await this.readOwnedParsed(join(this.pagesDirectory, name), 'page', (text) => parsePage(text, path))).value
        if (pages.some((item) => item.id === page.id)) throw new Error('Duplicate page ID')
        pages.push(page)
      } catch (error) { errors.push(`pages/${name}: ${String(error)}`) }
    }
    let workbench: WorkbenchConfig = defaultWorkbench
    try {
      const raw: unknown = YAML.parse(await this.readOwnedText(join(this.path, '.serenity', 'workbench.yaml')))
      if (!record(raw) || typeof raw.homePage !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(raw.homePage) ||
        !Array.isArray(raw.navigation) || raw.navigation.some((group: unknown) => !record(group) ||
          typeof group.group !== 'string' || !group.group.trim() || !Array.isArray(group.commands) ||
          group.commands.some((command: unknown) => typeof command !== 'string' || !/^[a-z0-9.-]+$/.test(command))) ||
        !pages.some((page) => page.id === raw.homePage)) throw new Error('Invalid workbench configuration or missing Home page')
      workbench = { homePage: raw.homePage, navigation: raw.navigation as WorkbenchConfig['navigation'] }
      if (raw.keybindings !== undefined) {
        if (record(raw.keybindings) && Object.entries(raw.keybindings).every(([id, value]) => /^[a-z0-9.-]+$/.test(id) &&
          (value === null || (typeof value === 'string' && normalizeKeybinding(value))))) workbench.keybindings = raw.keybindings as Record<string, string | null>
        else errors.push('.serenity/workbench.yaml: Invalid keybindings; map each command ID to a chord such as Mod+Shift+K, or to null')
      }
    } catch (error) { errors.push(`.serenity/workbench.yaml: ${String(error)}`) }
    const enabled: Record<ModuleId, boolean> = { calendar: true, tasks: true, semanticIndex: false, documentAnalysis: false }
    let semanticProvider: Provider = 'copilot'
    let backgroundProviderNeedsChoice = false
    let semanticIndex: WorkspaceSnapshot['semanticIndex'] = null
    try {
      const raw: unknown = YAML.parse(await this.readOwnedText(join(this.path, '.serenity', 'modules.yaml')))
      if (!record(raw)) throw new Error('Invalid module settings')
      for (const module of modules) {
        if (typeof raw[module.id] === 'boolean') enabled[module.id] = raw[module.id] as boolean
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`.serenity/modules.yaml: ${String(error)}`)
    }
    try {
      const raw: unknown = YAML.parse(await this.readOwnedText(join(this.path, '.serenity', 'semantic-provider.yaml')))
      if (record(raw) && !isProviderId(raw.provider) && typeof raw.provider === 'string' && raw.provider in retiredProviders) {
        // Background AI sends workspace content, so it waits for an explicit choice rather than moving to another service.
        backgroundProviderNeedsChoice = true
        errors.push(`.serenity/semantic-provider.yaml: ${retiredProviders[raw.provider]} is no longer offered. Background AI is paused until you choose a provider in Settings.`)
      } else {
        if (!record(raw) || !isProviderId(raw.provider)) throw new Error('Invalid provider setting')
        semanticProvider = raw.provider
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        backgroundProviderNeedsChoice = true
        errors.push(`.serenity/semantic-provider.yaml: ${String(error)}. Background AI is paused until you choose a supported provider.`)
      }
    }
    if (backgroundProviderNeedsChoice) {
      enabled.semanticIndex = false
      enabled.documentAnalysis = false
    }
    try {
      const raw: unknown = YAML.parse(await this.readOwnedText(join(this.path, '.serenity', 'semantic-index.yaml')))
      if (!record(raw) || !Array.isArray(raw.entries) || typeof raw.generatedAt !== 'string' ||
        typeof raw.provider !== 'string' || !raw.provider.trim() || raw.entries.some((entry: unknown) =>
          !record(entry) || typeof entry.key !== 'string' || typeof entry.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(entry.fingerprint) || typeof entry.summary !== 'string' ||
          !Array.isArray(entry.terms) || entry.terms.some((term: unknown) => typeof term !== 'string'))) throw new Error('Invalid semantic index')
      semanticIndex = { generatedAt: raw.generatedAt, count: raw.entries.length, provider: raw.provider }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`.serenity/semantic-index.yaml: ${String(error)}`)
    }
    // Entities archived on purpose (not merged) keep their names available to records that mention them.
    const removedDirectory = join(this.path, 'archive', 'removed', 'entities')
    for (const name of await readdir(removedDirectory).catch(() => [] as string[])) {
      if (!name.endsWith('.md')) continue
      try { archivedEntities.push({ ...(await this.readOwnedParsed(join(removedDirectory, name), 'entity', parseEntity)).value, archived: true }) }
      catch (error) { errors.push(`archive/removed/entities/${name}: ${String(error)}`) }
    }
    const mergesDirectory = join(this.path, 'archive', 'merges')
    const archivedDirectory = join(this.path, 'archive', 'entities')
    for (const name of (await readdir(archivedDirectory)).filter((entry) => entry.endsWith('.md'))) {
      try {
        const archived = (await this.readOwnedParsed(join(archivedDirectory, name), 'entity', parseEntity)).value
        if (`${archived.id}.md` !== name) throw new Error('Filename does not match archived entity ID')
        archivedEntities.push(archived)
      } catch (error) { errors.push(`archive/entities/${name}: ${String(error)}`) }
    }
    for (const name of (await readdir(mergesDirectory)).filter((entry) => entry.endsWith('.yaml'))) {
      try {
        const data: unknown = YAML.parse(await this.readOwnedText(join(mergesDirectory, name)))
        if (!record(data) || id(data.id) !== name.slice(0, -5)) throw new Error('Invalid merge record')
        const merge: MergeRecord = { id: id(data.id), target: id(data.target), title: requiredText(data.title, 'Title'),
          recordedAt: requiredText(data.recordedAt, 'Recorded at'), undoneAt: typeof data.undoneAt === 'string' ? data.undoneAt : undefined,
          undoReason: typeof data.undoReason === 'string' ? data.undoReason : undefined }
        if (!merge.undoneAt) merges.push(merge)
        mergeHistory.push(merge)
      } catch (error) { errors.push(`archive/merges/${name}: ${String(error)}`) }
    }
    const historyDirectory = join(mergesDirectory, 'history')
    for (const directory of await readdir(historyDirectory)) {
      const previousMerges = join(historyDirectory, directory)
      const info = await lstat(previousMerges)
      if (info.isSymbolicLink()) { errors.push(`archive/merges/history/${directory}: linked directories are not workspace content`); continue }
      if (!info.isDirectory()) continue
      for (const name of (await readdir(previousMerges)).filter((entry) => entry.endsWith('.yaml'))) {
        try {
          const data: unknown = YAML.parse(await this.readOwnedText(join(previousMerges, name)))
          if (!record(data) || id(data.id) !== directory) throw new Error('Invalid past merge')
          mergeHistory.push({ id: id(data.id), target: id(data.target), title: requiredText(data.title, 'Title'),
            recordedAt: requiredText(data.recordedAt, 'Recorded at'), undoneAt: requiredText(data.undoneAt, 'Undo time'),
            undoReason: requiredText(data.undoReason, 'Undo reason') })
        } catch (error) { errors.push(`archive/merges/history/${directory}/${name}: ${String(error)}`) }
      }
    }
    const resolve = (entityId: string): string => {
      const visited = new Set<string>()
      let current = entityId
      while (merges.some((item) => item.id === current) && !visited.has(current)) {
        visited.add(current)
        current = merges.find((item) => item.id === current)!.target
      }
      return current
    }
    for (const name of (await readdir(this.directories[7])).filter((entry) => entry.endsWith('.yaml')).sort()) {
      try {
        const data = (await this.readOwnedParsed<unknown>(join(this.directories[7], name), 'yaml', parseYaml)).value
        if (!record(data) || id(data.id) !== name.slice(0, -5)) throw new Error('Invalid resolution record')
        resolutions.push({ id: id(data.id), subject: resolve(id(data.subject)), key: requiredText(data.key, 'Key'),
          currentClaimId: data.currentClaimId === null ? null : id(data.currentClaimId),
          recordedAt: requiredText(data.recordedAt, 'Recorded at'), reason: requiredText(data.reason, 'Reason'),
          sequence: typeof data.sequence === 'number' && Number.isSafeInteger(data.sequence) ? data.sequence : undefined })
      } catch (error) { errors.push(`resolutions/${name}: ${String(error)}`) }
    }
    for (const name of (await readdir(this.directories[9])).filter((entry) => entry.endsWith('.yaml')).sort()) {
      try {
        const data = (await this.readOwnedParsed<unknown>(join(this.directories[9], name), 'yaml', parseYaml)).value
        if (!record(data) || data.version !== 1 || data.kind !== 'distinct' || id(data.id) !== name.slice(0, -5) ||
          id(data.left) >= id(data.right) || typeof data.recordedAt !== 'string' || !data.recordedAt.trim() ||
          (data.reason !== undefined && typeof data.reason !== 'string') ||
          (data.undoneAt !== undefined && (typeof data.undoneAt !== 'string' || !data.undoneAt.trim()))) throw new Error('Invalid identity decision')
        identityDecisions.push(data as unknown as IdentityDecision)
      } catch (error) { errors.push(`identity-decisions/${name}: ${String(error)}`) }
    }
    for (const name of (await readdir(this.directories[8])).filter((entry) => entry.endsWith('.yaml')).sort()) {
      try {
        const data = (await this.readOwnedParsed<unknown>(join(this.directories[8], name), 'yaml', parseYaml)).value
        if (!record(data) || id(data.id) !== name.slice(0, -5) || !Array.isArray(data.refs) ||
          typeof data.provider !== 'string' || !data.provider.trim() ||
          !['running', 'completed', 'failed'].includes(String(data.status))) throw new Error('Invalid provider activity')
        providerActivity.push(data as unknown as ProviderActivity)
      } catch (error) { errors.push(`activity/${name}: ${String(error)}`) }
    }
    for (const [directory, extension, parse] of [
      [this.directories[0], '.md', parseEntity],
      [this.directories[1], '.yaml', parseClaim]
    ] as const) {
      const names = (await readdir(directory)).filter((name) => name.endsWith(extension)).sort()
      const loaded = await inBatches(names, (name) => this.readOwnedParsed<Entity | Claim>(join(directory, name), extension, parse)
        .then((result) => ({ name, parsed: result.value }), (error: unknown) => ({ name, error })))
      for (const item of loaded) {
        try {
          if ('error' in item) throw item.error
          if (`${item.parsed.id}${extension}` !== item.name) throw new Error('Filename does not match record ID')
          // The two lists have different element types; each parser is paired with its list above.
          if (extension === '.md') entities.push(item.parsed as Entity)
          else claims.push(item.parsed as Claim)
        } catch (error) {
          errors.push(`${basename(directory)}/${item.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    for (const [directory, target] of [[this.directories[3], conversations], [this.directories[4], proposals]] as const) {
      for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.yaml')).sort()) {
        try {
          const { text, value: data } = await this.readOwnedParsed<unknown>(join(directory, name), 'yaml', parseYaml)
          if (!record(data) || id(data.id) !== name.slice(0, -5)) throw new Error('Invalid record or mismatched filename')
          if (directory === this.directories[3]) {
            if (!Array.isArray(data.messages) || typeof data.title !== 'string') throw new Error('Invalid conversation')
            conversations.push({ ...data, permissions: validateWorkflowPermissions(data.permissions),
              readScope: validateReadScope(data.readScope), revision: checksum(text) } as unknown as Conversation)
          } else {
            requiredText(data.status, 'Status')
            const kind = typeof data.kind === 'string' ? data.kind : 'claim'
            if (!['claim', 'entity', 'task', 'event'].includes(kind)) throw new Error('Invalid proposal kind')
            if (kind === 'claim') id(data.subject)
            else requiredText(data.title, 'Title')
            proposals.push({ ...data, kind } as unknown as Proposal)
          }
        } catch (error) {
          errors.push(`${basename(directory)}/${name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    for (const conversation of this.ephemeral.values()) conversations.push(conversation)
    for (const [directory, parse, archived] of [
      [this.directories[5], parseEvent, false], [this.directories[6], parseTask, false],
      [join(this.path, 'trash', 'calendar'), parseEvent, true],
      [join(this.path, 'archive', 'calendar'), parseEvent, true], [join(this.path, 'archive', 'tasks'), parseTask, true]
    ] as const) {
      for (const name of (await readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' && archived) return [] as string[]
        throw error
      })).filter((entry) => entry.endsWith('.yaml')).sort()) {
        try {
          const { text, value } = await this.readOwnedParsed<unknown>(join(directory, name), 'yaml', parseYaml)
          const parsed = parse(value)
          if (`${parsed.id}.yaml` !== name) throw new Error('Filename does not match record ID')
          if (parse === parseEvent) (archived ? archivedEvents : events).push({ ...parsed as CalendarEvent, revision: checksum(text) })
          else (archived ? archivedTasks : tasks).push({ ...parsed as TaskItem, revision: checksum(text) })
        } catch (error) { errors.push(`${basename(directory)}/${name}: ${String(error)}`) }
      }
    }
    for (const name of await readdir(this.directories[2])) {
      try {
        const info = await lstat(join(this.directories[2], name))
        if (info.isFile() && name.includes('\\')) errors.push(`documents/${name}: filename is not portable within this workspace`)
        else if (info.isFile()) documents.push({ name, size: info.size, extractable: canExtractText(name) })
        else if (info.isSymbolicLink()) errors.push(`documents/${name}: linked files are not part of this workspace; import a copy instead`)
      } catch { /* A document was moved while reading the directory. */ }
    }
    for (const claim of claims) {
      const originalSubject = claim.subject
      claim.subject = resolve(claim.subject)
      claim.value = resolve(claim.value)
      if (claim.subject !== originalSubject) claim.mergedFrom = originalSubject
    }
    const current = new Map<string, string | null>()
    for (const item of resolutions.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))) {
      current.set(`${item.subject}\u0000${item.key}`, item.currentClaimId)
    }
    for (const claim of claims) {
      const chosen = current.get(`${claim.subject}\u0000${claim.key}`)
      if (chosen && claim.status === 'confirmed') claim.isCurrent = chosen === claim.id
    }
    for (const proposal of proposals) {
      if (proposal.kind === 'claim') proposal.subject = resolve(proposal.subject)
      if (proposal.kind === 'task' || proposal.kind === 'event') proposal.relatedEntityIds = proposal.relatedEntityIds.map(resolve)
    }
    for (const event of events) event.relatedEntityIds = event.relatedEntityIds.map(resolve)
    for (const event of archivedEvents) event.relatedEntityIds = event.relatedEntityIds.map(resolve)
    for (const task of tasks) task.relatedEntityIds = task.relatedEntityIds.map(resolve)
    for (const task of archivedTasks) task.relatedEntityIds = task.relatedEntityIds.map(resolve)
    // Every snapshot reads every record, so entries it did not touch belong to deleted or moved files.
    for (const path of this.fileCache.keys()) if (!this.readSinceSweep.has(path)) this.fileCache.delete(path)
    this.readSinceSweep = new Set()
    return { path: this.path, generation, pages, workbench, entities, archivedEntities, claims, resolutions, conversations, proposals, documents,
      events, archivedEvents, tasks, archivedTasks, merges, mergeHistory, identityDecisions, modules: enabled, semanticProvider,
      backgroundProviderNeedsChoice, semanticIndex, providerActivity, errors }
  }

  async saveEntity(input: Entity): Promise<WorkspaceSnapshot> {
    const entityId = input.id ? id(input.id) : randomUUID()
    const title = requiredText(input.title, 'Title')
    const type = requiredText(input.type, 'Type')
    const path = join(this.directories[0], `${entityId}.md`)
    return this.withFileMutation(path, async () => {
      const previous = await this.readOwnedText(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (previous && checksum(previous) !== input.revision) {
        throw new Error('This entity changed on disk. Refresh before saving to avoid overwriting it.')
      }
      if (!previous && input.revision) throw new Error('This entity was removed on disk. Refresh before saving.')
      if (!previous && input.id) throw new Error('Create a new entity without an ID. Refresh before saving this entity.')
      if (typeof input.body !== 'string') throw new Error('Body must be text')
      const metadata = previous ? updateYaml(frontmatter.exec(previous)?.[1] ?? '',
        { id: entityId, title, type, source: input.source, origin: input.origin ?? 'human' }) :
        YAML.stringify({ ...input.metadata, id: entityId, title, type, source: input.source, origin: input.origin ?? 'human' })
      const text = `---\n${metadata}---\n${input.body}`
      await atomicWrite(path, text)
      this.markDirty()
      return this.snapshot()
    })
  }

  async savePage(input: Pick<WorkspacePage, 'id' | 'path' | 'text' | 'revision'>): Promise<WorkspaceSnapshot> {
    const page = (await this.snapshot()).pages.find((item) => item.id === input.id && item.path === input.path)
    if (!page) throw new Error('Page not found in this workspace')
    if (typeof input.text !== 'string') throw new Error('Page must contain text')
    const next = parsePage(input.text, page.path)
    if (next.id !== page.id) throw new Error('Page ID cannot change during an edit')
    const path = await this.ownedFile(join(this.pagesDirectory, basename(page.path)))
    return this.withFileMutation(path, async () => {
      if (checksum(await this.readOwnedText(path)) !== input.revision) throw new Error('This page changed on disk. Refresh before saving to avoid overwriting it.')
      await atomicWrite(path, input.text)
      this.markDirty()
      return this.snapshot()
    })
  }

  /**
   * After a rename, points `[[from]]` wikilinks in the given pages and entity notes at `to`. Only prose is changed:
   * frontmatter, code, and other links stay as written. Returns how many links changed along with the new snapshot.
   */
  async renameWikilinks(from: string, to: string, uris: string[]): Promise<{ snapshot: WorkspaceSnapshot; count: number }> {
    const title = (value: unknown, label: string): string => {
      const text = requiredText(value, label).trim()
      if (/[[\]|#\n]/.test(text) || text.length > 300) throw new Error(`${label} cannot be used in a wikilink`)
      return text
    }
    const oldTitle = title(from, 'Previous title')
    const newTitle = title(to, 'New title')
    if (!Array.isArray(uris) || uris.length > 500) throw new Error('Invalid list of notes to update')
    const snapshot = await this.snapshot()
    let count = 0
    for (const uri of new Set(uris)) {
      const ref = typeof uri === 'string' ? parseResourceUri(uri) : null
      const path = ref?.kind === 'page' ? snapshot.pages.find((page) => page.id === ref.id)?.path.replace(/^pages\//, '') : undefined
      const file = ref?.kind === 'entity' && snapshot.entities.some((entity) => entity.id === ref.id) ? join(this.directories[0], `${ref.id}.md`)
        : path ? join(this.pagesDirectory, basename(path)) : null
      if (!file) continue
      count += await this.withFileMutation(file, async () => {
        const text = await this.readOwnedText(await this.ownedFile(file))
        const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)?.[0] ?? ''
        const renamed = renameWikilinks(text.slice(frontmatter.length), oldTitle, newTitle)
        if (renamed.count) await atomicWrite(file, frontmatter + renamed.text)
        return renamed.count
      })
    }
    this.markDirty()
    return { snapshot: await this.snapshot(), count }
  }

  async createPage(): Promise<WorkspaceSnapshot> {
    await this.verifyDirectories()
    const pageId = `page-${randomUUID()}`
    const text = `---\nid: ${pageId}\ntitle: Untitled page\nkind: page\n---\n# Untitled page\n\nStart writing here.\n`
    await writeFile(join(this.pagesDirectory, `${pageId}.md`), text, { flag: 'wx' })
    this.markDirty()
    return this.snapshot()
  }

  async loadSession(): Promise<WorkbenchSession | null> {
    let text: string
    try {
      text = await this.readSettingsFile('session.yaml')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let raw: unknown
    try { raw = YAML.parse(text) }
    catch { await this.archiveDamagedSession(); return null }
    try { return await this.validatedSession(raw) }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'Invalid workspace session') throw error
      await this.archiveDamagedSession()
      return null
    }
  }

  /** Keep invalid presentation state for inspection before a fresh session can replace it. */
  private async archiveDamagedSession(): Promise<void> {
    const path = join(this.path, '.serenity', 'session.yaml')
    await rename(path, `${path}.corrupt-${randomUUID()}`)
  }

  /** A settings correction must not erase the unreadable file the person may need to inspect. */
  private async archiveInvalidSetting(name: 'modules.yaml' | 'semantic-provider.yaml', valid: (raw: unknown) => boolean): Promise<void> {
    const path = join(this.path, '.serenity', name)
    let text: string
    try { text = await this.readOwnedText(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    let acceptable = false
    try { acceptable = valid(YAML.parse(text)) }
    catch { /* Preserve malformed YAML below. */ }
    if (!acceptable) await rename(path, `${path}.corrupt-${randomUUID()}`)
  }

  async saveSession(session: WorkbenchSession): Promise<void> {
    const previous = this.sessionMutation
    let release!: () => void
    this.sessionMutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const validated = await this.validatedSession(session)
      await atomicWrite(join(this.path, '.serenity', 'session.yaml'), YAML.stringify(validated))
    } finally { release() }
  }

  private async validatedSession(value: unknown): Promise<WorkbenchSession> {
    if (!record(value) || typeof value.view !== 'string' || !isWorkbenchView(value.view) ||
      !Array.isArray(value.openUris) || value.openUris.length > 30 || value.openUris.some((uri: unknown) => typeof uri !== 'string' || !isTabUri(uri)) ||
      (value.activeUri !== undefined && (typeof value.activeUri !== 'string' || !isTabUri(value.activeUri))) ||
      (value.assistantUri !== undefined && (typeof value.assistantUri !== 'string' || parseResourceUri(value.assistantUri)?.kind !== 'conversation'))) throw new Error('Invalid workspace session')
    // View tabs are always kept; the renderer drops those whose module is off.
    const available = new Set([...workspaceResources(await this.snapshot()).map((item) => item.uri), ...tabViews.map(viewTabUri)])
    const openUris = (uris: string[]): string[] => [...new Set(uris.filter((uri) => available.has(uri)))]
    const activeUri = (uri: unknown): string | undefined => typeof uri === 'string' && available.has(uri) ? uri : undefined
    const layout = value.layout === undefined ? null : parseLayout(value.layout, isWorkbenchView, isTabUri)
    return { view: value.view, openUris: openUris(value.openUris as string[]), activeUri: activeUri(value.activeUri),
      ...(typeof value.assistantUri === 'string' && available.has(value.assistantUri) ? { assistantUri: value.assistantUri } : {}),
      ...(layout ? { layout: { ...layout, groups: layout.groups.map((group) => {
        const active = activeUri(group.activeUri)
        const open = openUris(group.openUris)
        const presentations = Object.fromEntries(Object.entries(group.presentations ?? {}).filter(([uri]) => open.includes(uri)))
        return { id: group.id, view: group.view, openUris: open, ...(active ? { activeUri: active } : {}), ...(Object.keys(presentations).length ? { presentations } : {}),
          ...(group.viewPresentations ? { viewPresentations: group.viewPresentations } : {}) }
      }) } } : {}) }
  }

  async addClaim(input: Pick<Claim, 'subject' | 'key' | 'value' | 'source'>): Promise<WorkspaceSnapshot> {
    const subject = id(input.subject)
    const entityPath = join(this.directories[0], `${subject}.md`)
    const entity = parseEntity(await this.readOwnedText(entityPath))
    if (entity.id !== subject) throw new Error('Claim subject does not match entity')
    const claim: Claim = {
      id: randomUUID(), subject,
      key: requiredText(input.key, 'Key'),
      value: requiredText(input.value, 'Value'),
      source: requiredText(input.source, 'Source'),
      origin: 'human', status: 'confirmed', recordedAt: new Date().toISOString()
    }
    const path = join(this.directories[1], `${claim.id}.yaml`)
    await writeFile(path, YAML.stringify(claim), { flag: 'wx' })
    this.markDirty()
    return this.snapshot()
  }

  async retractClaim(claimId: string, reason: string): Promise<WorkspaceSnapshot> {
    const selected = (await this.snapshot()).claims.find((item) => item.id === claimId)
    const path = join(this.directories[1], `${id(claimId)}.yaml`)
    const original = await this.readOwnedText(path)
    const claim = parseClaim(original)
    if (claim.id !== claimId || claim.status !== 'confirmed') throw new Error('Only confirmed claims can be retracted')
    claim.status = 'retracted'
    claim.retractedAt = new Date().toISOString()
    claim.retractionReason = requiredText(reason, 'Reason')
    if (checksum(await this.readOwnedText(path)) !== checksum(original)) throw new Error('Claim changed on disk. Refresh before retracting it.')
    await atomicWrite(path, updateYaml(original, { status: claim.status, retractedAt: claim.retractedAt,
      retractionReason: claim.retractionReason }))
    this.markDirty()
    if (selected?.isCurrent) await this.recordResolution({ subject: selected.subject, key: selected.key,
      currentClaimId: null, reason: 'Selected claim was retracted' })
    return this.snapshot()
  }

  async setCurrentClaim(claimId: string, reason: string): Promise<WorkspaceSnapshot> {
    const snapshot = await this.snapshot()
    const claim = snapshot.claims.find((item) => item.id === id(claimId) && item.status === 'confirmed')
    if (!claim) throw new Error('Choose a confirmed claim')
    await this.recordResolution({ subject: claim.subject, key: claim.key, currentClaimId: claim.id, reason })
    return this.snapshot()
  }

  async clearCurrentClaim(subject: string, key: string): Promise<WorkspaceSnapshot> {
    const snapshot = await this.snapshot()
    const selected = snapshot.claims.find((item) => item.subject === id(subject) && item.key === key && item.isCurrent)
    if (!selected) throw new Error('No current claim to clear')
    await this.recordResolution({ subject, key, currentClaimId: null, reason: 'Current designation cleared by user' })
    return this.snapshot()
  }

  private async recordResolution(input: Pick<ClaimResolution, 'subject' | 'key' | 'currentClaimId' | 'reason'>): Promise<void> {
    const previous = (await this.snapshot()).resolutions
    const resolution: ClaimResolution = {
      id: randomUUID(), subject: id(input.subject), key: requiredText(input.key, 'Key'), currentClaimId: input.currentClaimId,
      reason: requiredText(input.reason, 'Reason'), recordedAt: new Date().toISOString(),
      sequence: previous.reduce((highest, item) => Math.max(highest, item.sequence ?? 0), 0) + 1
    }
    await writeFile(join(this.directories[7], `${resolution.id}.yaml`), YAML.stringify(resolution), { flag: 'wx' })
    this.markDirty()
  }

  async mergeEntities(sourceId: string, targetId: string): Promise<WorkspaceSnapshot> {
    return this.withIdentityMutation(() => this.mergeEntitiesNow(sourceId, targetId))
  }

  private async mergeEntitiesNow(sourceId: string, targetId: string): Promise<WorkspaceSnapshot> {
    const source = id(sourceId)
    const target = id(targetId)
    if (source === target) throw new Error('Choose two different entities')
    const from = join(this.directories[0], `${source}.md`)
    return this.withFileMutation(from, async () => {
      const snapshot = await this.snapshot()
      const original = snapshot.entities.find((entity) => entity.id === source)
      if (!original || !snapshot.entities.some((entity) => entity.id === target)) throw new Error('Both entities must be active before merging')
      const proposedMerges = [...snapshot.merges, { id: source, target }]
      if (snapshot.identityDecisions.some((decision) => !decision.undoneAt &&
        new Set(distinctRepresentatives(decision, proposedMerges)).size === 1)) {
        throw new Error('These entities were marked distinct. Undo that decision before merging them.')
      }
      const archived = join(this.path, 'archive', 'entities', `${source}.md`)
      const record: MergeRecord = { id: source, target, title: original.title, recordedAt: new Date().toISOString() }
      const history = join(this.path, 'archive', 'merges', `${source}.yaml`)
      for (const path of [archived, history]) {
        try { await lstat(path); throw new Error(`A prior merge file already exists: ${basename(path)}`) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      await rename(from, archived)
      try { await writeFile(history, YAML.stringify(record), { flag: 'wx' }) }
      catch (error) { await rename(archived, from); throw error }
      this.markDirty()
      return this.snapshot()
    })
  }

  async unmergeEntities(sourceId: string, reason: string): Promise<WorkspaceSnapshot> {
    return this.withIdentityMutation(() => this.unmergeEntitiesNow(sourceId, reason))
  }

  private async unmergeEntitiesNow(sourceId: string, reason: string): Promise<WorkspaceSnapshot> {
    const source = id(sourceId)
    const active = join(this.directories[0], `${source}.md`)
    return this.withFileMutation(active, async () => {
      if (!(await this.snapshot()).merges.some((item) => item.id === source)) throw new Error('This entity is not currently merged')
      const archived = join(this.path, 'archive', 'entities', `${source}.md`)
      const recordPath = join(this.path, 'archive', 'merges', `${source}.yaml`)
      const previous = await this.readOwnedText(recordPath)
      if (parseEntity(await this.readOwnedText(archived)).id !== source) throw new Error('Archived entity ID does not match the merge')
      try { await lstat(active); throw new Error('An active entity already uses this ID') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const historyDirectory = join(this.path, 'archive', 'merges', 'history', source)
      await mkdir(historyDirectory, { recursive: true })
      const history = join(historyDirectory, `${randomUUID()}.yaml`)
      const updated = updateYaml(previous, { undoneAt: new Date().toISOString(), undoReason: requiredText(reason, 'Undo reason') })
      await rename(archived, active)
      try {
        await atomicWrite(recordPath, updated)
        await rename(recordPath, history)
      } catch (error) {
        await rename(history, recordPath).catch(() => undefined)
        await atomicWrite(recordPath, previous).catch(() => undefined)
        await rename(active, archived).catch(() => undefined)
        throw error
      }
      this.markDirty()
      return this.snapshot()
    })
  }

  async markDistinctEntities(leftId: string, rightId: string): Promise<WorkspaceSnapshot> {
    return this.withIdentityMutation(() => this.markDistinctEntitiesNow(leftId, rightId))
  }

  private async markDistinctEntitiesNow(leftId: string, rightId: string): Promise<WorkspaceSnapshot> {
    const [left, right] = [id(leftId), id(rightId)].sort()
    if (left === right) throw new Error('Choose two different entities')
    const snapshot = await this.snapshot()
    if (!snapshot.entities.some((entity) => entity.id === left) || !snapshot.entities.some((entity) => entity.id === right)) {
      throw new Error('Both entities must be active before marking them distinct')
    }
    if (snapshot.identityDecisions.some((decision) => !decision.undoneAt &&
      distinctRepresentatives(decision, snapshot.merges).sort().join(':') === [left, right].join(':'))) {
      throw new Error('These entities are already marked distinct')
    }
    const decision: IdentityDecision = { version: 1, id: randomUUID(), kind: 'distinct', left, right, recordedAt: new Date().toISOString() }
    await writeFile(join(this.directories[9], `${decision.id}.yaml`), YAML.stringify(decision), { flag: 'wx' })
    this.markDirty()
    return this.snapshot()
  }

  async undoIdentityDecision(decisionId: string): Promise<WorkspaceSnapshot> {
    return this.withIdentityMutation(() => this.undoIdentityDecisionNow(decisionId))
  }

  private async undoIdentityDecisionNow(decisionId: string): Promise<WorkspaceSnapshot> {
    const path = join(this.directories[9], `${id(decisionId)}.yaml`)
    const original = await this.readOwnedText(path)
    const decision = (await this.snapshot()).identityDecisions.find((item) => item.id === decisionId)
    if (!decision || decision.undoneAt) throw new Error('This distinct-identity decision is unavailable or already undone')
    await atomicWrite(path, updateYaml(original, { undoneAt: new Date().toISOString() }))
    this.markDirty()
    return this.snapshot()
  }

  async importDocument(sourcePath: string): Promise<void> {
    const name = basename(sourcePath)
    if (name.includes('\\')) throw new Error('Document filename is not portable within this workspace')
    const extension = extname(name)
    const base = extension ? name.slice(0, -extension.length) : name
    let candidate = name
    let count = 2
    while (true) {
      try {
        await copyFile(sourcePath, join(this.directories[2], candidate), 1)
        this.markDirty()
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        candidate = `${base} (${count++})${extension}`
      }
    }
  }

  /** Extracted text, reused while the file's size and modification time are unchanged, so reindexing stays cheap. */
  private async documentText(name: string): Promise<string> {
    const path = await this.documentPath(name)
    const info = await lstat(path)
    const version = `${info.size}:${info.mtimeMs}`
    const cached = this.extractedText.get(name)
    if (cached?.version === version) return cached.text
    const text = await extractDocument(path) ?? ''
    this.extractedText.set(name, { version, text })
    return text
  }

  /**
   * Brings the full-text index up to date with the workspace. Concurrent callers share one rebuild, and a change that
   * arrives during a rebuild triggers another, so the index never settles on stale content.
   */
  async refreshSearchIndex(): Promise<void> {
    while (this.indexDirty || !this.index) {
      this.indexing ??= this.rebuildSearchIndex().finally(() => { this.indexing = null })
      await this.indexing
    }
  }

  private async rebuildSearchIndex(): Promise<void> {
    if (!this.index) {
      const path = join(this.path, '.serenity', 'index.sqlite')
      try {
        try { await this.ownedFile(path) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        this.index = new DatabaseSync(path)
        this.index.exec('CREATE VIRTUAL TABLE IF NOT EXISTS records USING fts5(id UNINDEXED, kind UNINDEXED, title, detail, content)')
      } catch (error) {
        this.index?.close()
        this.index = null
        const message = String(error).toLowerCase()
        if (!message.includes('not a database') && !message.includes('database disk image is malformed')) throw error
        await rename(path, `${path}.corrupt-${randomUUID()}`)
        this.index = new DatabaseSync(path)
        this.index.exec('CREATE VIRTUAL TABLE records USING fts5(id UNINDEXED, kind UNINDEXED, title, detail, content)')
        this.markDirty()
      }
    }
    if (!this.index) return
    this.indexDirty = false
    const snapshot = await this.snapshot()
    const titles = new Map(snapshot.entities.map((entity) => [entity.id, entity.title]))
    const insert = this.index.prepare('INSERT INTO records (id, kind, title, detail, content) VALUES (?, ?, ?, ?, ?)')
    this.index.exec('BEGIN TRANSACTION')
    try {
      this.index.exec('DELETE FROM records')
      for (const page of snapshot.pages) insert.run(page.id, 'page', page.title, 'Workspace page', page.body)
      for (const entity of snapshot.entities) insert.run(entity.id, 'entity', entity.title, entity.type, `${entity.body} ${metadataText(entity.metadata)}`)
      for (const claim of snapshot.claims.filter((item) => item.status !== 'retracted')) {
        const targetName = titles.get(claim.value) ?? claim.value
        const context = claim.isCurrent ? 'Current' : claim.isCurrent === false ? 'Historical alternative' : 'Sourced claim'
        insert.run(claim.subject, 'claim', `${claim.key}: ${targetName}`, `${context} · ${claim.source}`, `${targetName} ${claim.value} ${metadataText(claim.metadata)}`)
      }
      if (snapshot.modules.tasks) {
        for (const task of snapshot.tasks) insert.run(task.id, 'task', task.title, task.due ?? 'Undated task', `${task.notes} ${metadataText(task.metadata)} ${task.relatedEntityIds.map((id) => snapshot.entities.find((entity) => entity.id === id)?.title ?? id).join(' ')}`)
      }
      if (snapshot.modules.calendar) {
        for (const event of snapshot.events) insert.run(event.id, 'event', event.title, event.start, `${event.notes} ${metadataText(event.metadata)} ${event.relatedEntityIds.map((id) => snapshot.entities.find((entity) => entity.id === id)?.title ?? id).join(' ')}`)
      }
      for (const document of snapshot.documents) {
        let text = ''
        try { text = await this.documentText(document.name) } catch { /* unsupported or unreadable document remains in the list */ }
        insert.run(document.name, 'document', document.name, 'Imported document', text)
      }
      this.index.exec('COMMIT')
    } catch (error) {
      this.index.exec('ROLLBACK')
      this.indexDirty = true
      throw error
    }
  }

  async search(term: string): Promise<SearchResult[]> {
    const query = requiredText(term, 'Search')
    await this.refreshSearchIndex()
    if (!this.index) return []
    const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 1 && !new Set(['what', 'where', 'when', 'which', 'with', 'about', 'from', 'should', 'would']).has(word)) ?? []
    if (!words.length) return []
    const terms = words.slice(0, 16).map((word) => `"${word.replaceAll('"', '""')}"*`)
    // Titles weigh more than details and body text, and records containing every word come before those with some.
    const select = this.index.prepare("SELECT kind, id, title, detail, snippet(records, 4, char(1), char(2), '…', 14) AS excerpt FROM records WHERE records MATCH ? ORDER BY bm25(records, 0, 0, 8, 2, 1) LIMIT 100")
    const all = terms.length > 1 ? select.all(terms.join(' AND ')) : []
    // An excerpt helps only when it shows where the words matched; otherwise the title already explains the result.
    const withExcerpts = (rows: unknown[]): SearchResult[] => (rows as (SearchResult & { excerpt?: string | null })[]).map(({ excerpt, ...result }) =>
      excerpt && excerpt.includes('\u0001') ? { ...result, excerpt: excerpt.replace(/\s+/g, ' ').trim() } : result)
    return rankSearchResults(query, [...withExcerpts(all), ...withExcerpts(select.all(terms.join(' OR ')))]).slice(0, 100)
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const path = join(this.directories[3], `${id(conversation.id)}.yaml`)
    return this.withFileMutation(path, async () => {
      if (conversation.retained) {
        const previous = await this.readOwnedText(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (previous && checksum(previous) !== conversation.revision) throw new Error('Conversation changed on disk. Refresh before continuing it.')
        if (!previous && conversation.revision) throw new Error('Conversation was removed on disk. Refresh before continuing it.')
        this.ephemeral.delete(conversation.id)
        const text = YAML.stringify({ ...conversation, revision: undefined })
        await atomicWrite(path, text)
        conversation.revision = checksum(text)
      } else {
        this.ephemeral.set(conversation.id, conversation)
        await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        conversation.revision = undefined
      }
    })
  }

  async updateConversationSettings(conversationId: string,
    settings: { autonomy: Autonomy; permissions: WorkflowPermissions; retained: boolean; readScope?: ReadScope }): Promise<WorkspaceSnapshot> {
    const conversation = (await this.snapshot()).conversations.find((item) => item.id === id(conversationId))
    if (!conversation) throw new Error('Conversation not found')
    if (!['ask', 'propose', 'autonomous'].includes(settings.autonomy) || typeof settings.retained !== 'boolean') {
      throw new Error('Invalid workflow settings')
    }
    conversation.autonomy = settings.autonomy
    conversation.permissions = validateWorkflowPermissions(settings.permissions)
    conversation.readScope = validateReadScope(settings.readScope ?? conversation.readScope)
    conversation.retained = settings.retained
    await this.saveConversation(conversation)
    return this.snapshot()
  }

  async starConversation(conversationId: string, starred: boolean): Promise<WorkspaceSnapshot> {
    if (typeof starred !== 'boolean') throw new Error('Invalid star value')
    const conversation = (await this.snapshot()).conversations.find((item) => item.id === id(conversationId))
    if (!conversation) throw new Error('Conversation not found')
    conversation.starred = starred
    await this.saveConversation(conversation)
    return this.snapshot()
  }

  async deleteConversation(conversationId: string): Promise<WorkspaceSnapshot> {
    const target = id(conversationId)
    const snapshot = await this.snapshot()
    if (!snapshot.conversations.some((item) => item.id === target)) throw new Error('Conversation not found')
    const proposals = snapshot.proposals.filter((item) => item.conversationId === target)
    const selected = new Set<string>()
    const add = (path: string): void => { selected.add(path) }
    const claims = new Set<string>()
    const entities = new Set<string>()
    const ownedBy = (item: { metadata?: Record<string, unknown> }, proposalId: string): boolean => item.metadata?.proposalId === proposalId
    const unique = <T>(items: T[], label: string): T | undefined => {
      if (items.length > 1) throw new Error(`Cannot safely delete this chat: more than one ${label} matches an older proposal.`)
      return items[0]
    }
    for (const proposal of proposals) {
      add(join(this.directories[4], `${id(proposal.id)}.yaml`))
      if (proposal.status !== 'accepted') continue
      if (proposal.kind === 'claim' || (proposal.kind === 'entity' && proposal.resolvedInto)) {
        const subject = proposal.kind === 'claim' ? proposal.subject : proposal.resolvedInto!
        const key = proposal.kind === 'claim' ? proposal.key : 'context'
        const value = proposal.kind === 'claim' ? proposal.value : proposal.body.trim() || `${proposal.title} (${proposal.type})`
        const exact = snapshot.claims.filter((item) => item.subject === subject && item.key === key && item.value === value && item.source === proposal.source && item.origin === proposal.origin)
        const claim = unique(snapshot.claims.filter((item) => ownedBy(item, proposal.id)).length ?
          snapshot.claims.filter((item) => ownedBy(item, proposal.id)) : exact, 'claim')
        if (claim) claims.add(claim.id)
      } else if (proposal.kind === 'entity') {
        if (proposal.createdEntityId && snapshot.archivedEntities.some((item) => item.id === proposal.createdEntityId))
          throw new Error('Cannot safely delete this chat: an entity it created is archived or merged. Restore it first.')
        const entity = snapshot.entities.find((item) => item.id === proposal.createdEntityId) ??
          unique(snapshot.entities.filter((item) => ownedBy(item, proposal.id)), 'entity')
        if (entity) entities.add(entity.id)
      } else if (proposal.kind === 'task') {
        const matches = [...snapshot.tasks, ...snapshot.archivedTasks]
        const task = matches.find((item) => item.id === proposal.createdResourceId) ?? unique(matches.filter((item) => ownedBy(item, proposal.id)).length ?
          matches.filter((item) => ownedBy(item, proposal.id)) : matches.filter((item) => item.title === proposal.title && item.source === proposal.source && item.origin === proposal.origin), 'task')
        if (task) add(join(this.path, snapshot.archivedTasks.some((item) => item.id === task.id) ? 'archive' : '',
          'tasks', `${id(task.id)}.yaml`))
      } else if (proposal.kind === 'event') {
        const matches = [...snapshot.events, ...snapshot.archivedEvents]
        const event = matches.find((item) => item.id === proposal.createdResourceId) ?? unique(matches.filter((item) => ownedBy(item, proposal.id)).length ?
          matches.filter((item) => ownedBy(item, proposal.id)) : matches.filter((item) => item.title === proposal.title && item.source === proposal.source && item.origin === proposal.origin), 'event')
        if (event) {
          const active = snapshot.events.some((item) => item.id === event.id)
          const trash = join(this.path, 'trash', 'calendar', `${id(event.id)}.yaml`)
          const archived = join(this.path, 'archive', 'calendar', `${id(event.id)}.yaml`)
          add(active ? join(this.directories[5], `${id(event.id)}.yaml`) : await lstat(trash).then(() => trash, () => archived))
        }
      }
    }
    for (const claim of snapshot.claims) if (claim.metadata?.conversationId === target) claims.add(claim.id)
    for (const entity of snapshot.entities) if (entity.metadata?.conversationId === target) entities.add(entity.id)
    for (const task of [...snapshot.tasks, ...snapshot.archivedTasks]) if (task.metadata?.conversationId === target)
      add(join(this.path, snapshot.archivedTasks.some((item) => item.id === task.id) ? 'archive' : '', 'tasks', `${id(task.id)}.yaml`))
    for (const event of [...snapshot.events, ...snapshot.archivedEvents]) if (event.metadata?.conversationId === target) {
      const file = `${id(event.id)}.yaml`
      const trash = join(this.path, 'trash', 'calendar', file)
      add(snapshot.events.some((item) => item.id === event.id) ? join(this.directories[5], file) : await lstat(trash).then(() => trash, () => join(this.path, 'archive', 'calendar', file)))
    }
    for (const entityId of entities) {
      const dependencies = snapshot.claims.some((claim) => (claim.subject === entityId || claim.value === entityId) && !claims.has(claim.id)) ||
        snapshot.tasks.some((task) => task.relatedEntityIds.includes(entityId) && task.metadata?.conversationId !== target) ||
        snapshot.events.some((event) => event.relatedEntityIds.includes(entityId) && event.metadata?.conversationId !== target) ||
        snapshot.merges.some((merge) => merge.target === entityId) ||
        snapshot.identityDecisions.some((decision) => decision.left === entityId || decision.right === entityId)
      if (dependencies) throw new Error('Cannot safely delete this chat: an entity it created is used by knowledge from another source.')
      add(join(this.directories[0], `${id(entityId)}.md`))
    }
    for (const claimId of claims) add(join(this.directories[1], `${id(claimId)}.yaml`))
    for (const resolution of snapshot.resolutions) if (resolution.currentClaimId && claims.has(resolution.currentClaimId))
      add(join(this.directories[7], `${id(resolution.id)}.yaml`))
    const withinTurn = (conversation: Conversation, activity: ProviderActivity): boolean => {
      const started = Date.parse(activity.startedAt)
      if (!Number.isFinite(started)) return false
      return conversation.messages.some((message, index) => {
        if (message.role !== 'user' || (message.provider && message.provider !== activity.provider)) return false
        const next = conversation.messages.slice(index + 1).find((item) => item.role === 'assistant')
        if (!next) return false
        const from = Date.parse(message.recordedAt)
        const to = Date.parse(next.recordedAt)
        return Number.isFinite(from) && Number.isFinite(to) && started >= from - 2000 && started <= to + 2000
      })
    }
    const conversation = snapshot.conversations.find((item) => item.id === target)!
    for (const activity of snapshot.providerActivity) {
      if (activity.conversationId === target) { add(join(this.directories[8], `${id(activity.id)}.yaml`)); continue }
      if (activity.conversationId || !['conversation', 'document-analysis'].includes(activity.operation) || !withinTurn(conversation, activity)) continue
      if (snapshot.conversations.some((other) => other.id !== target && withinTurn(other, activity)))
        throw new Error('Cannot safely identify an older Activity entry shared by overlapping chats.')
      add(join(this.directories[8], `${id(activity.id)}.yaml`))
    }
    add(join(this.directories[3], `${target}.yaml`))
    // Verify every file before removing any, so a stale or linked record never causes partial deletion.
    for (const path of selected) await this.readOwnedText(path).catch((error: NodeJS.ErrnoException) => {
      if (path === join(this.directories[3], `${target}.yaml`) && error.code === 'ENOENT') return
      throw error
    })
    for (const path of selected) await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (path === join(this.directories[3], `${target}.yaml`) && error.code === 'ENOENT') return
      throw error
    })
    this.ephemeral.delete(target)
    this.markDirty()
    return this.snapshot()
  }

  async addProposal(proposal: Proposal): Promise<void> {
    await writeFile(join(this.directories[4], `${id(proposal.id)}.yaml`), YAML.stringify(proposal), { flag: 'wx' })
  }

  async resolveProposal(proposalId: string, accept: boolean): Promise<WorkspaceSnapshot> {
    const path = join(this.directories[4], `${id(proposalId)}.yaml`)
    const data: unknown = YAML.parse(await this.readOwnedText(path))
    if (!record(data) || data.id !== proposalId || data.status !== 'pending') throw new Error('Proposal no longer pending. Refresh to see the current state.')
    const proposal = { ...data, kind: data.kind ?? 'claim' } as unknown as Proposal
    if (accept) {
      if (proposal.kind === 'claim') {
        const active = (await this.snapshot()).proposals.find((item) => item.id === proposalId)
        if (!active || active.kind !== 'claim') throw new Error('Claim proposal not found')
        const entity = parseEntity(await this.readOwnedText(join(this.directories[0], `${id(active.subject)}.md`)))
        const claim: Claim = {
          id: randomUUID(), subject: entity.id, key: requiredText(proposal.key, 'Key'),
          value: requiredText(proposal.value, 'Value'), source: requiredText(proposal.source, 'Source'),
          origin: proposal.origin, confidence: proposal.confidence, status: 'confirmed', recordedAt: new Date().toISOString(),
          metadata: { proposalId: proposal.id, conversationId: proposal.conversationId }
        }
        await writeFile(join(this.directories[1], `${claim.id}.yaml`), YAML.stringify(claim), { flag: 'wx' })
        this.markDirty()
      } else if (proposal.kind === 'entity') {
        const priorIds = new Set((await this.snapshot()).entities.map((entity) => entity.id))
        const saved = await this.saveEntity({ id: '', title: proposal.title, type: proposal.type, body: proposal.body,
          source: proposal.source, origin: proposal.origin, metadata: { proposalId: proposal.id, conversationId: proposal.conversationId } })
        const created = saved.entities.find((entity) => !priorIds.has(entity.id))
        if (!created) throw new Error('New entity was not readable after creation')
        proposal.createdEntityId = created.id
      } else if (proposal.kind === 'task') {
        const priorIds = new Set((await this.snapshot()).tasks.map((item) => item.id))
        const saved = await this.saveTask({ id: '', title: proposal.title, due: proposal.due, notes: proposal.notes,
          completed: false, relatedEntityIds: proposal.relatedEntityIds, source: proposal.source, origin: proposal.origin,
          metadata: { proposalId: proposal.id, conversationId: proposal.conversationId } })
        proposal.createdResourceId = saved.tasks.find((item) => !priorIds.has(item.id))?.id
      } else {
        const priorIds = new Set((await this.snapshot()).events.map((item) => item.id))
        const saved = await this.saveEvent({ id: '', title: proposal.title, start: proposal.start, end: proposal.end,
          notes: proposal.notes, relatedEntityIds: proposal.relatedEntityIds, source: proposal.source, origin: proposal.origin,
          metadata: { proposalId: proposal.id, conversationId: proposal.conversationId } })
        proposal.createdResourceId = saved.events.find((item) => !priorIds.has(item.id))?.id
      }
    }
    proposal.status = accept ? 'accepted' : 'rejected'
    await atomicWrite(path, YAML.stringify(proposal))
    return this.snapshot()
  }

  async attachEntityProposal(proposalId: string, entityId: string): Promise<WorkspaceSnapshot> {
    const path = join(this.directories[4], `${id(proposalId)}.yaml`)
    const original = await this.readOwnedText(path)
    const data: unknown = YAML.parse(original)
    if (!record(data) || data.id !== proposalId || data.kind !== 'entity' || data.status !== 'pending') {
      throw new Error('Entity proposal is no longer pending. Refresh before attaching it.')
    }
    const subject = id(entityId)
    const entity = parseEntity(await this.readOwnedText(join(this.directories[0], `${subject}.md`)))
    if (entity.id !== subject) throw new Error('Selected entity has changed on disk')
    const source = requiredText(data.source, 'Source')
    const type = requiredText(data.type, 'Type')
    const title = requiredText(data.title, 'Title')
    const value = typeof data.body === 'string' && data.body.trim() ? data.body.trim() : `${title} (${type})`
    if (data.origin !== 'ai-statement' && data.origin !== 'ai-inference') throw new Error('Invalid proposal origin')
    const existing = (await this.snapshot()).claims.some((claim) => claim.subject === subject && claim.key === 'context' &&
      claim.value === value && claim.source === source && claim.status === 'confirmed')
    const claim: Claim = {
      id: randomUUID(), subject, key: 'context', value, source,
      origin: data.origin, status: 'confirmed', recordedAt: new Date().toISOString(),
      metadata: { proposalId, conversationId: data.conversationId }
    }
    const claimPath = join(this.directories[1], `${claim.id}.yaml`)
    if (!existing) await writeFile(claimPath, YAML.stringify(claim), { flag: 'wx' })
    try {
      if (checksum(await this.readOwnedText(path)) !== checksum(original)) throw new Error('Proposal changed on disk. Refresh before attaching it.')
      await atomicWrite(path, updateYaml(original, { status: 'accepted', resolvedInto: subject }))
    }
    catch (error) { if (!existing) await unlink(claimPath).catch(() => undefined); throw error }
    this.markDirty()
    return this.snapshot()
  }

  async setModule(moduleId: ModuleId, enabled: boolean): Promise<WorkspaceSnapshot> {
    if (!modules.some((item) => item.id === moduleId) || typeof enabled !== 'boolean') throw new Error('Invalid module setting')
    const path = join(this.path, '.serenity', 'modules.yaml')
    return this.withFileMutation(path, async () => {
      const snapshot = await this.snapshot()
      if (enabled && snapshot.backgroundProviderNeedsChoice && (moduleId === 'semanticIndex' || moduleId === 'documentAnalysis')) {
        throw new Error('Choose a supported background AI provider before enabling this module')
      }
      const current = snapshot.modules
      current[moduleId] = enabled
      await this.archiveInvalidSetting('modules.yaml', record)
      await atomicWrite(path, YAML.stringify(current))
      this.markDirty()
      return this.snapshot()
    })
  }

  async setSemanticProvider(provider: Provider): Promise<WorkspaceSnapshot> {
    if (!isProviderId(provider)) throw new Error('Unknown provider')
    await this.archiveInvalidSetting('semantic-provider.yaml', (raw) => record(raw) && (isProviderId(raw.provider) || String(raw.provider) in retiredProviders))
    await atomicWrite(join(this.path, '.serenity', 'semantic-provider.yaml'), YAML.stringify({ provider }))
    return this.snapshot()
  }

  private async saveModuleRecord(directory: string, value: CalendarEvent | TaskItem, creating: boolean): Promise<WorkspaceSnapshot> {
    const recordId = value.id ? id(value.id) : randomUUID()
    const path = join(directory, `${recordId}.yaml`)
    return this.withFileMutation(path, async () => {
      const previous = await this.readOwnedText(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (previous && checksum(previous) !== value.revision) throw new Error('This item changed on disk. Refresh before saving.')
      if (!previous && value.revision) throw new Error('This item was removed on disk. Refresh before saving.')
      if (!previous && !creating) throw new Error('Create a new item without an ID. Refresh before saving this item.')
      const { metadata, revision: _revision, ...recordData } = value
      const text = previous ? updateYaml(previous, { ...recordData, id: recordId }) :
        YAML.stringify({ ...metadata, ...recordData, id: recordId })
      await atomicWrite(path, text)
      this.markDirty()
      return this.snapshot()
    })
  }

  async saveEvent(value: CalendarEvent): Promise<WorkspaceSnapshot> {
    return this.withFileMutation(join(this.path, '.serenity', 'modules.yaml'), async () => {
      if (!(await this.snapshot()).modules.calendar) throw new Error('Calendar module is disabled')
      const event = parseEvent({ ...value, id: value.id || randomUUID(), recordedAt: value.recordedAt ?? new Date().toISOString() })
      if (event.end && event.end < event.start) throw new Error('End date must follow start date')
      return this.saveModuleRecord(this.directories[5], { ...event, revision: value.revision }, !value.id)
    })
  }

  async saveTask(value: TaskItem): Promise<WorkspaceSnapshot> {
    return this.withFileMutation(join(this.path, '.serenity', 'modules.yaml'), async () => {
      if (!(await this.snapshot()).modules.tasks) throw new Error('Tasks module is disabled')
      const task = parseTask({ ...value, id: value.id || randomUUID(), recordedAt: value.recordedAt ?? new Date().toISOString() })
      return this.saveModuleRecord(this.directories[6], { ...task, revision: value.revision }, !value.id)
    })
  }

  private async archiveModuleRecord(directory: string, recordId: string, revision: string): Promise<WorkspaceSnapshot> {
    const file = `${id(recordId)}.yaml`
    const source = join(directory, file)
    return this.withFileMutation(source, async () => {
      const current = await this.readOwnedText(source)
      if (checksum(current) !== revision) throw new Error('This item changed on disk. Refresh before archiving it.')
      await this.trashItem(source)
      this.markDirty()
      return this.snapshot()
    })
  }

  private async restoreModuleRecord(directory: string, category: 'calendar' | 'tasks', recordId: string): Promise<WorkspaceSnapshot> {
    const file = `${id(recordId)}.yaml`
    const source = join(this.path, 'archive', category, file)
    const destination = join(directory, file)
    return this.withFileMutation(join(this.path, '.serenity', 'modules.yaml'), async () => {
      if (!(await this.snapshot()).modules[category]) throw new Error(`${category} module is disabled`)
      return this.withFileMutation(destination, async () => {
        try { await lstat(destination); throw new Error('An active item already uses this ID.') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        await rename(source, destination)
        this.markDirty()
        return this.snapshot()
      })
    })
  }

  async archiveEvent(recordId: string, revision: string): Promise<WorkspaceSnapshot> {
    const file = `${id(recordId)}.yaml`
    const source = join(this.directories[5], file)
    return this.withFileMutation(source, async () => {
      if (checksum(await this.readOwnedText(source)) !== revision) throw new Error('This event changed on disk. Refresh before moving it to Trash.')
      await this.trashItem(source)
      this.markDirty()
      return this.snapshot()
    })
  }

  async restoreEvent(recordId: string): Promise<WorkspaceSnapshot> {
    const file = `${id(recordId)}.yaml`
    const trashed = join(this.path, 'trash', 'calendar', file)
    try { await lstat(trashed) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.restoreModuleRecord(this.directories[5], 'calendar', recordId)
      throw error
    }
    const destination = join(this.directories[5], file)
    return this.withFileMutation(destination, async () => {
      if (!(await this.snapshot()).modules.calendar) throw new Error('Calendar module is disabled')
      try { await lstat(destination); throw new Error('An active event already uses this ID.') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await rename(trashed, destination)
      this.markDirty()
      return this.snapshot()
    })
  }

  /** Moves a page to the system Trash after checking its revision. The Home page cannot be removed. */
  async archivePage(pageId: string, revision: string): Promise<WorkspaceSnapshot> {
    const snapshot = await this.snapshot()
    const page = snapshot.pages.find((item) => item.id === pageId)
    if (!page) throw new Error('Page not found in this workspace')
    if (page.id === snapshot.workbench.homePage) throw new Error('The Home page cannot be archived. Choose another Home page in .serenity/workbench.yaml first.')
    const source = await this.ownedFile(join(this.pagesDirectory, basename(page.path)))
    return this.withFileMutation(source, async () => {
      if (checksum(await this.readOwnedText(source)) !== revision) throw new Error('This page changed on disk. Refresh before archiving it.')
      await this.trashItem(source)
      this.markDirty()
      return this.snapshot()
    })
  }

  /** A Markdown or plain-text document's text and revision, for editing it in place. */
  async readEditableDocument(name: string): Promise<{ text: string; revision: string }> {
    if (!editableDocument.test(name)) throw new Error('Only Markdown and plain-text documents can be edited here')
    const text = await this.readOwnedText(await this.documentPath(name))
    return { text, revision: checksum(text) }
  }

  /** Saves an edited Markdown or plain-text document, refusing if it changed on disk since `revision`. */
  async saveDocumentText(name: string, text: string, revision: string): Promise<{ snapshot: WorkspaceSnapshot; revision: string }> {
    if (!editableDocument.test(name)) throw new Error('Only Markdown and plain-text documents can be edited here')
    if (typeof text !== 'string') throw new Error('Document text must be text')
    const path = await this.documentPath(name)
    return this.withFileMutation(path, async () => {
      if (checksum(await this.readOwnedText(path)) !== revision) throw new Error('This document changed on disk. Refresh before saving to avoid overwriting it.')
      await atomicWrite(path, text)
      this.extractedText.delete(name)
      this.markDirty()
      return { snapshot: await this.snapshot(), revision: checksum(text) }
    })
  }

  /** Creates an empty Markdown document (Untitled.md, or a numbered name beside existing ones) and returns its name. */
  async createDocument(): Promise<{ snapshot: WorkspaceSnapshot; name: string }> {
    await this.verifyDirectories()
    const path = await freeName(this.directories[2], 'Untitled.md')
    await writeFile(path, '', { flag: 'wx' })
    this.markDirty()
    return { snapshot: await this.snapshot(), name: basename(path) }
  }

  /**
   * Sets a command's shortcut in `.serenity/workbench.yaml`: a chord, `null` to remove its default, or `undefined` to go
   * back to the default. Other settings and comments in the file stay as written.
   */
  async setKeybinding(commandId: string, chord: string | null | undefined): Promise<WorkspaceSnapshot> {
    if (typeof commandId !== 'string' || !/^[a-z][a-z0-9.-]{0,80}$/.test(commandId)) throw new Error('Invalid command ID')
    const normalized = chord === null || chord === undefined ? chord : normalizeKeybinding(chord)
    if (normalized === null && chord !== null) throw new Error('Choose a chord with ⌘/Ctrl or Alt, such as Mod+Shift+K')
    const path = join(this.path, '.serenity', 'workbench.yaml')
    return this.withFileMutation(path, async () => {
      const document = YAML.parseDocument(await this.readOwnedText(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return YAML.stringify(defaultWorkbench)
        throw error
      }))
      if (document.errors.length) throw new Error('.serenity/workbench.yaml cannot be read; fix it before changing shortcuts here')
      if (normalized === undefined) document.deleteIn(['keybindings', commandId])
      else document.setIn(['keybindings', commandId], normalized)
      const keybindings = document.get('keybindings')
      if (YAML.isMap(keybindings) && keybindings.items.length === 0) document.delete('keybindings')
      await atomicWrite(path, document.toString())
      this.markDirty()
      return this.snapshot()
    })
  }

  /** Moves an entity and its own claims to the system Trash. Merge history stays in the workspace. */
  async archiveEntity(entityId: string, revision: string): Promise<WorkspaceSnapshot> {
    return this.withIdentityMutation(async () => {
      const subject = id(entityId)
      const source = join(this.directories[0], `${subject}.md`)
      return this.withFileMutation(source, async () => {
        const snapshot = await this.snapshot()
        const entity = snapshot.entities.find((item) => item.id === subject)
        if (!entity) throw new Error('Entity not found in this workspace')
        if (entity.revision !== revision) throw new Error('This entity changed on disk. Refresh before archiving it.')
        if (snapshot.merges.some((merge) => merge.target === subject)) throw new Error('Other entities were merged into this one. Restore them before archiving it.')
        for (const claim of snapshot.claims.filter((item) => item.subject === subject && !item.mergedFrom)) {
          const file = join(this.directories[1], `${id(claim.id)}.yaml`)
          await this.trashItem(await this.ownedFile(file)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
          })
        }
        await this.trashItem(await this.ownedFile(source))
        this.markDirty()
        return this.snapshot()
      })
    })
  }

  /** Moves a document to the system Trash; facts citing it keep their source text. */
  async archiveDocument(name: string): Promise<WorkspaceSnapshot> {
    if (typeof name !== 'string' || !name || name !== basename(name) || name.startsWith('.')) throw new Error('Invalid document name')
    const source = await this.ownedFile(join(this.directories[2], name))
    return this.withFileMutation(source, async () => {
      await this.trashItem(source)
      this.markDirty()
      return this.snapshot()
    })
  }

  async archiveTask(id: string, revision: string): Promise<WorkspaceSnapshot> {
    return this.archiveModuleRecord(this.directories[6], id, revision)
  }

  async restoreTask(id: string): Promise<WorkspaceSnapshot> {
    return this.restoreModuleRecord(this.directories[6], 'tasks', id)
  }
}
