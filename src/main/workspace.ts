import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import YAML from 'yaml'
import type { CalendarEvent, Claim, ClaimResolution, Conversation, DocumentInfo, Entity, MergeRecord, Proposal, Provider, ProviderActivity, SearchResult, TaskItem, WorkspaceSnapshot } from '../shared/types'
import { modules, type ModuleId } from '../shared/modules'
import { extractDocument } from './documents'

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
    recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : undefined }
}

function parseTask(data: unknown): TaskItem {
  if (!record(data)) throw new Error('Invalid task')
  return { id: id(data.id), title: requiredText(data.title, 'Title'), due: date(data.due, 'due date', true),
    completed: data.completed === true, notes: typeof data.notes === 'string' ? data.notes : '',
    relatedEntityIds: related(data.relatedEntityIds ?? []),
    source: typeof data.source === 'string' ? data.source : undefined,
    origin: typeof data.origin === 'string' ? data.origin as TaskItem['origin'] : undefined,
    recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : undefined }
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
    revision: checksum(text)
  }
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
    confidence: typeof data.confidence === 'number' && data.confidence >= 0 && data.confidence <= 1 ? data.confidence : undefined
  }
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

  constructor(readonly path: string) {}

  get directories(): string[] {
    return ['entities', 'claims', 'documents', 'conversations', 'proposals', 'calendar', 'tasks', 'resolutions', 'activity'].map((name) => join(this.path, name))
  }

  async initialize(): Promise<void> {
    for (const directory of this.directories) await mkdir(directory, { recursive: true })
    await mkdir(join(this.path, '.serenity'), { recursive: true })
    await mkdir(join(this.path, 'archive', 'entities'), { recursive: true })
    await mkdir(join(this.path, 'archive', 'merges'), { recursive: true })
  }

  markDirty(): void { this.indexDirty = true }
  close(): void { this.index?.close(); this.index = null; this.indexDirty = true }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const entities: Entity[] = []
    const claims: Claim[] = []
    const resolutions: ClaimResolution[] = []
    const providerActivity: ProviderActivity[] = []
    const conversations: Conversation[] = []
    const proposals: Proposal[] = []
    const documents: DocumentInfo[] = []
    const events: CalendarEvent[] = []
    const tasks: TaskItem[] = []
    const merges: MergeRecord[] = []
    const archivedEntities: Entity[] = []
    const errors: string[] = []
    const enabled: Record<ModuleId, boolean> = { calendar: true, tasks: true, semanticIndex: false, documentAnalysis: false }
    let semanticProvider: Provider = 'copilot'
    let semanticIndex: WorkspaceSnapshot['semanticIndex'] = null
    try {
      const raw: unknown = YAML.parse(await readFile(join(this.path, '.serenity', 'modules.yaml'), 'utf8'))
      if (!record(raw)) throw new Error('Invalid module settings')
      for (const module of modules) {
        if (typeof raw[module.id] === 'boolean') enabled[module.id] = raw[module.id] as boolean
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`.serenity/modules.yaml: ${String(error)}`)
    }
    try {
      const raw: unknown = YAML.parse(await readFile(join(this.path, '.serenity', 'semantic-provider.yaml'), 'utf8'))
      if (!record(raw) || !['copilot', 'codex', 'claude'].includes(String(raw.provider))) throw new Error('Invalid provider setting')
      semanticProvider = raw.provider as Provider
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`.serenity/semantic-provider.yaml: ${String(error)}`)
    }
    try {
      const raw: unknown = YAML.parse(await readFile(join(this.path, '.serenity', 'semantic-index.yaml'), 'utf8'))
      if (!record(raw) || !Array.isArray(raw.entries) || typeof raw.generatedAt !== 'string') throw new Error('Invalid semantic index')
      semanticIndex = { generatedAt: raw.generatedAt, count: raw.entries.length }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`.serenity/semantic-index.yaml: ${String(error)}`)
    }
    const mergesDirectory = join(this.path, 'archive', 'merges')
    const archivedDirectory = join(this.path, 'archive', 'entities')
    for (const name of (await readdir(archivedDirectory)).filter((entry) => entry.endsWith('.md'))) {
      try {
        const archived = parseEntity(await readFile(join(archivedDirectory, name), 'utf8'))
        if (`${archived.id}.md` !== name) throw new Error('Filename does not match archived entity ID')
        archivedEntities.push(archived)
      } catch (error) { errors.push(`archive/entities/${name}: ${String(error)}`) }
    }
    for (const name of (await readdir(mergesDirectory)).filter((entry) => entry.endsWith('.yaml'))) {
      try {
        const data: unknown = YAML.parse(await readFile(join(mergesDirectory, name), 'utf8'))
        if (!record(data) || id(data.id) !== name.slice(0, -5)) throw new Error('Invalid merge record')
        merges.push({ id: id(data.id), target: id(data.target), title: requiredText(data.title, 'Title'), recordedAt: requiredText(data.recordedAt, 'Recorded at') })
      } catch (error) { errors.push(`archive/merges/${name}: ${String(error)}`) }
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
        const data: unknown = YAML.parse(await readFile(join(this.directories[7], name), 'utf8'))
        if (!record(data) || id(data.id) !== name.slice(0, -5)) throw new Error('Invalid resolution record')
        resolutions.push({ id: id(data.id), subject: resolve(id(data.subject)), key: requiredText(data.key, 'Key'),
          currentClaimId: data.currentClaimId === null ? null : id(data.currentClaimId),
          recordedAt: requiredText(data.recordedAt, 'Recorded at'), reason: requiredText(data.reason, 'Reason'),
          sequence: typeof data.sequence === 'number' && Number.isSafeInteger(data.sequence) ? data.sequence : undefined })
      } catch (error) { errors.push(`resolutions/${name}: ${String(error)}`) }
    }
    for (const name of (await readdir(this.directories[8])).filter((entry) => entry.endsWith('.yaml')).sort()) {
      try {
        const data: unknown = YAML.parse(await readFile(join(this.directories[8], name), 'utf8'))
        if (!record(data) || id(data.id) !== name.slice(0, -5) || !Array.isArray(data.refs) ||
          !['copilot', 'codex', 'claude'].includes(String(data.provider)) ||
          !['running', 'completed', 'failed'].includes(String(data.status))) throw new Error('Invalid provider activity')
        providerActivity.push(data as unknown as ProviderActivity)
      } catch (error) { errors.push(`activity/${name}: ${String(error)}`) }
    }
    for (const [directory, extension, parse] of [
      [this.directories[0], '.md', parseEntity],
      [this.directories[1], '.yaml', parseClaim]
    ] as const) {
      const names = await readdir(directory)
      for (const name of names.filter((name) => name.endsWith(extension)).sort()) {
        try {
          const parsed = parse(await readFile(join(directory, name), 'utf8'))
          if (`${parsed.id}${extension}` !== name) throw new Error('Filename does not match record ID')
          // The two lists have different element types; each parser is paired with its list above.
          if (extension === '.md') entities.push(parsed as Entity)
          else claims.push(parsed as Claim)
        } catch (error) {
          errors.push(`${basename(directory)}/${name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    for (const [directory, target] of [[this.directories[3], conversations], [this.directories[4], proposals]] as const) {
      for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.yaml')).sort()) {
        try {
          const text = await readFile(join(directory, name), 'utf8')
          const data: unknown = YAML.parse(text)
          if (!record(data) || id(data.id) !== name.slice(0, -5)) throw new Error('Invalid record or mismatched filename')
          if (directory === this.directories[3]) {
            if (!Array.isArray(data.messages) || typeof data.title !== 'string') throw new Error('Invalid conversation')
            conversations.push({ ...data, revision: checksum(text) } as unknown as Conversation)
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
    for (const [directory, parse, target] of [
      [this.directories[5], parseEvent, events], [this.directories[6], parseTask, tasks]
    ] as const) {
      for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.yaml')).sort()) {
        try {
          const text = await readFile(join(directory, name), 'utf8')
          const parsed = parse(YAML.parse(text))
          if (`${parsed.id}.yaml` !== name) throw new Error('Filename does not match record ID')
          if (directory === this.directories[5]) events.push({ ...parsed as CalendarEvent, revision: checksum(text) })
          else tasks.push({ ...parsed as TaskItem, revision: checksum(text) })
        } catch (error) { errors.push(`${basename(directory)}/${name}: ${String(error)}`) }
      }
    }
    for (const name of await readdir(this.directories[2])) {
      try {
        const info = await stat(join(this.directories[2], name))
        if (info.isFile()) documents.push({ name, size: info.size })
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
    for (const task of tasks) task.relatedEntityIds = task.relatedEntityIds.map(resolve)
    return { path: this.path, entities, archivedEntities, claims, resolutions, conversations, proposals, documents, events, tasks, merges, modules: enabled, semanticProvider, semanticIndex, providerActivity, errors }
  }

  async saveEntity(input: Entity): Promise<WorkspaceSnapshot> {
    const entityId = input.id ? id(input.id) : randomUUID()
    const title = requiredText(input.title, 'Title')
    const type = requiredText(input.type, 'Type')
    const path = join(this.directories[0], `${entityId}.md`)
    const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (previous && checksum(previous) !== input.revision) {
      throw new Error('This entity changed on disk. Refresh before saving to avoid overwriting it.')
    }
    if (!previous && input.revision) throw new Error('This entity was removed on disk. Refresh before saving.')
    if (typeof input.body !== 'string') throw new Error('Body must be text')
    const text = `---\n${YAML.stringify({ id: entityId, title, type, source: input.source, origin: input.origin ?? 'human' })}---\n${input.body}`
    await atomicWrite(path, text)
    this.markDirty()
    return this.snapshot()
  }

  async addClaim(input: Pick<Claim, 'subject' | 'key' | 'value' | 'source'>): Promise<WorkspaceSnapshot> {
    const subject = id(input.subject)
    const entityPath = join(this.directories[0], `${subject}.md`)
    const entity = parseEntity(await readFile(entityPath, 'utf8'))
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
    const original = await readFile(path, 'utf8')
    const claim = parseClaim(original)
    if (claim.id !== claimId || claim.status !== 'confirmed') throw new Error('Only confirmed claims can be retracted')
    claim.status = 'retracted'
    claim.retractedAt = new Date().toISOString()
    claim.retractionReason = requiredText(reason, 'Reason')
    if (checksum(await readFile(path, 'utf8')) !== checksum(original)) throw new Error('Claim changed on disk. Refresh before retracting it.')
    await atomicWrite(path, YAML.stringify(claim))
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
    const source = id(sourceId)
    const target = id(targetId)
    if (source === target) throw new Error('Choose two different entities')
    const snapshot = await this.snapshot()
    const original = snapshot.entities.find((entity) => entity.id === source)
    if (!original || !snapshot.entities.some((entity) => entity.id === target)) throw new Error('Both entities must be active before merging')
    const from = join(this.directories[0], `${source}.md`)
    const archived = join(this.path, 'archive', 'entities', `${source}.md`)
    const record: MergeRecord = { id: source, target, title: original.title, recordedAt: new Date().toISOString() }
    const history = join(this.path, 'archive', 'merges', `${source}.yaml`)
    await rename(from, archived)
    try { await writeFile(history, YAML.stringify(record), { flag: 'wx' }) }
    catch (error) { await rename(archived, from); throw error }
    this.markDirty()
    return this.snapshot()
  }

  async importDocument(sourcePath: string): Promise<void> {
    const name = basename(sourcePath)
    const extension = extname(name)
    const base = name.slice(0, name.length - extension.length)
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

  async search(term: string): Promise<SearchResult[]> {
    const query = requiredText(term, 'Search')
    if (!this.index) {
      this.index = new DatabaseSync(join(this.path, '.serenity', 'index.sqlite'))
      this.index.exec('CREATE VIRTUAL TABLE IF NOT EXISTS records USING fts5(id UNINDEXED, kind UNINDEXED, title, detail, content)')
    }
    if (this.indexDirty) {
      const snapshot = await this.snapshot()
      const insert = this.index.prepare('INSERT INTO records (id, kind, title, detail, content) VALUES (?, ?, ?, ?, ?)')
      this.index.exec('BEGIN TRANSACTION')
      try {
        this.index.exec('DELETE FROM records')
        for (const entity of snapshot.entities) insert.run(entity.id, 'entity', entity.title, entity.type, entity.body)
        for (const claim of snapshot.claims.filter((item) => item.status !== 'retracted')) {
          const targetName = snapshot.entities.find((entity) => entity.id === claim.value)?.title ?? claim.value
          const context = claim.isCurrent ? 'Current' : claim.isCurrent === false ? 'Historical alternative' : 'Sourced claim'
          insert.run(claim.subject, 'claim', `${claim.key}: ${targetName}`, `${context} · ${claim.source}`, `${targetName} ${claim.value}`)
        }
        if (snapshot.modules.tasks) {
          for (const task of snapshot.tasks) insert.run(task.id, 'task', task.title, task.due ?? 'Undated task', `${task.notes} ${task.relatedEntityIds.map((id) => snapshot.entities.find((entity) => entity.id === id)?.title ?? id).join(' ')}`)
        }
        if (snapshot.modules.calendar) {
          for (const event of snapshot.events) insert.run(event.id, 'event', event.title, event.start, `${event.notes} ${event.relatedEntityIds.map((id) => snapshot.entities.find((entity) => entity.id === id)?.title ?? id).join(' ')}`)
        }
        for (const document of snapshot.documents) {
          let text = ''
          try { text = await extractDocument(join(this.directories[2], document.name)) ?? '' } catch { /* unsupported or unreadable document remains in the list */ }
          insert.run(document.name, 'document', document.name, 'Imported document', text)
        }
        this.index.exec('COMMIT')
        this.indexDirty = false
      } catch (error) {
        this.index.exec('ROLLBACK')
        throw error
      }
    }
    const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 1 && !new Set(['what', 'where', 'when', 'which', 'with', 'about', 'from', 'should', 'would']).has(word)) ?? []
    if (!words.length) return []
    const terms = words.slice(0, 16).map((word) => `"${word.replaceAll('"', '""')}"*`).join(' OR ')
    return this.index.prepare('SELECT kind, id, title, detail FROM records WHERE records MATCH ? ORDER BY rank LIMIT 100').all(terms) as unknown as SearchResult[]
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const path = join(this.directories[3], `${id(conversation.id)}.yaml`)
    if (conversation.retained) {
      const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
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
  }

  async deleteConversation(conversationId: string): Promise<WorkspaceSnapshot> {
    this.ephemeral.delete(id(conversationId))
    await unlink(join(this.directories[3], `${conversationId}.yaml`)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    return this.snapshot()
  }

  async addProposal(proposal: Proposal): Promise<void> {
    await writeFile(join(this.directories[4], `${id(proposal.id)}.yaml`), YAML.stringify(proposal), { flag: 'wx' })
  }

  async resolveProposal(proposalId: string, accept: boolean): Promise<WorkspaceSnapshot> {
    const path = join(this.directories[4], `${id(proposalId)}.yaml`)
    const data: unknown = YAML.parse(await readFile(path, 'utf8'))
    if (!record(data) || data.id !== proposalId || data.status !== 'pending') throw new Error('Proposal no longer pending. Refresh to see the current state.')
    const proposal = { ...data, kind: data.kind ?? 'claim' } as unknown as Proposal
    if (accept) {
      if (proposal.kind === 'claim') {
        const active = (await this.snapshot()).proposals.find((item) => item.id === proposalId)
        if (!active || active.kind !== 'claim') throw new Error('Claim proposal not found')
        const entity = parseEntity(await readFile(join(this.directories[0], `${id(active.subject)}.md`), 'utf8'))
        const claim: Claim = {
          id: randomUUID(), subject: entity.id, key: requiredText(proposal.key, 'Key'),
          value: requiredText(proposal.value, 'Value'), source: requiredText(proposal.source, 'Source'),
          origin: proposal.origin, confidence: proposal.confidence, status: 'confirmed', recordedAt: new Date().toISOString()
        }
        await writeFile(join(this.directories[1], `${claim.id}.yaml`), YAML.stringify(claim), { flag: 'wx' })
        this.markDirty()
      } else if (proposal.kind === 'entity') {
        await this.saveEntity({ id: '', title: proposal.title, type: proposal.type, body: proposal.body,
          source: proposal.source, origin: proposal.origin })
      } else if (proposal.kind === 'task') {
        await this.saveTask({ id: '', title: proposal.title, due: proposal.due, notes: proposal.notes,
          completed: false, relatedEntityIds: proposal.relatedEntityIds, source: proposal.source, origin: proposal.origin })
      } else {
        await this.saveEvent({ id: '', title: proposal.title, start: proposal.start, end: proposal.end,
          notes: proposal.notes, relatedEntityIds: proposal.relatedEntityIds, source: proposal.source, origin: proposal.origin })
      }
    }
    proposal.status = accept ? 'accepted' : 'rejected'
    await atomicWrite(path, YAML.stringify(proposal))
    return this.snapshot()
  }

  async setModule(moduleId: ModuleId, enabled: boolean): Promise<WorkspaceSnapshot> {
    if (!modules.some((item) => item.id === moduleId) || typeof enabled !== 'boolean') throw new Error('Invalid module setting')
    const current = (await this.snapshot()).modules
    current[moduleId] = enabled
    await atomicWrite(join(this.path, '.serenity', 'modules.yaml'), YAML.stringify(current))
    this.markDirty()
    return this.snapshot()
  }

  async setSemanticProvider(provider: Provider): Promise<WorkspaceSnapshot> {
    if (!['copilot', 'codex', 'claude'].includes(provider)) throw new Error('Unknown provider')
    await atomicWrite(join(this.path, '.serenity', 'semantic-provider.yaml'), YAML.stringify({ provider }))
    return this.snapshot()
  }

  private async saveModuleRecord(directory: string, value: CalendarEvent | TaskItem): Promise<WorkspaceSnapshot> {
    const recordId = value.id ? id(value.id) : randomUUID()
    const path = join(directory, `${recordId}.yaml`)
    const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (previous && checksum(previous) !== value.revision) throw new Error('This item changed on disk. Refresh before saving.')
    if (!previous && value.revision) throw new Error('This item was removed on disk. Refresh before saving.')
    const text = YAML.stringify({ ...value, id: recordId, revision: undefined })
    await atomicWrite(path, text)
    this.markDirty()
    return this.snapshot()
  }

  async saveEvent(value: CalendarEvent): Promise<WorkspaceSnapshot> {
    if (!(await this.snapshot()).modules.calendar) throw new Error('Calendar module is disabled')
    const event = parseEvent({ ...value, id: value.id || randomUUID(), recordedAt: value.recordedAt ?? new Date().toISOString() })
    if (event.end && event.end < event.start) throw new Error('End date must follow start date')
    return this.saveModuleRecord(this.directories[5], { ...event, revision: value.revision })
  }

  async saveTask(value: TaskItem): Promise<WorkspaceSnapshot> {
    if (!(await this.snapshot()).modules.tasks) throw new Error('Tasks module is disabled')
    const task = parseTask({ ...value, id: value.id || randomUUID(), recordedAt: value.recordedAt ?? new Date().toISOString() })
    return this.saveModuleRecord(this.directories[6], { ...task, revision: value.revision })
  }
}
