import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import YAML from 'yaml'
import type { CalendarEvent, Claim, Conversation, DocumentInfo, Entity, MergeRecord, Proposal, SearchResult, TaskItem, WorkspaceSnapshot } from '../shared/types'
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
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(text) || Number.isNaN(Date.parse(text))) throw new Error(`Invalid ${name}`)
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
    relatedEntityIds: related(data.relatedEntityIds ?? []) }
}

function parseTask(data: unknown): TaskItem {
  if (!record(data)) throw new Error('Invalid task')
  return { id: id(data.id), title: requiredText(data.title, 'Title'), due: date(data.due, 'due date', true),
    completed: data.completed === true, notes: typeof data.notes === 'string' ? data.notes : '',
    relatedEntityIds: related(data.relatedEntityIds ?? []) }
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
    revision: checksum(text)
  }
}

function parseClaim(text: string): Claim {
  const data: unknown = YAML.parse(text)
  if (!record(data)) throw new Error('Invalid claim')
  const origin = requiredText(data.origin, 'Origin')
  const status = requiredText(data.status, 'Status')
  if (!['human', 'ai-statement', 'ai-inference'].includes(origin)) throw new Error('Invalid origin')
  if (!['confirmed', 'proposed'].includes(status)) throw new Error('Invalid status')
  return {
    id: id(data.id),
    subject: id(data.subject),
    key: requiredText(data.key, 'Key'),
    value: requiredText(data.value, 'Value'),
    source: requiredText(data.source, 'Source'),
    origin: origin as Claim['origin'],
    status: status as Claim['status'],
    recordedAt: requiredText(data.recordedAt, 'Recorded at')
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
    return ['entities', 'claims', 'documents', 'conversations', 'proposals', 'calendar', 'tasks'].map((name) => join(this.path, name))
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
    const conversations: Conversation[] = []
    const proposals: Proposal[] = []
    const documents: DocumentInfo[] = []
    const events: CalendarEvent[] = []
    const tasks: TaskItem[] = []
    const merges: MergeRecord[] = []
    const errors: string[] = []
    const enabled: Record<ModuleId, boolean> = { calendar: true, tasks: true }
    try {
      const raw: unknown = YAML.parse(await readFile(join(this.path, '.serenity', 'modules.yaml'), 'utf8'))
      if (!record(raw)) throw new Error('Invalid module settings')
      for (const module of modules) {
        if (typeof raw[module.id] === 'boolean') enabled[module.id] = raw[module.id] as boolean
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`.serenity/modules.yaml: ${String(error)}`)
    }
    const mergesDirectory = join(this.path, 'archive', 'merges')
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
          const data: unknown = YAML.parse(await readFile(join(directory, name), 'utf8'))
          if (!record(data) || id(data.id) !== name.slice(0, -5)) throw new Error('Invalid record or mismatched filename')
          if (directory === this.directories[3]) {
            if (!Array.isArray(data.messages) || typeof data.title !== 'string') throw new Error('Invalid conversation')
            conversations.push(data as unknown as Conversation)
          } else {
            requiredText(data.subject, 'Subject')
            requiredText(data.status, 'Status')
            proposals.push(data as unknown as Proposal)
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
    for (const proposal of proposals) proposal.subject = resolve(proposal.subject)
    for (const event of events) event.relatedEntityIds = event.relatedEntityIds.map(resolve)
    for (const task of tasks) task.relatedEntityIds = task.relatedEntityIds.map(resolve)
    return { path: this.path, entities, claims, conversations, proposals, documents, events, tasks, merges, modules: enabled, errors }
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
    const text = `---\n${YAML.stringify({ id: entityId, title, type })}---\n${input.body}`
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
        for (const claim of snapshot.claims) {
          const targetName = snapshot.entities.find((entity) => entity.id === claim.value)?.title ?? claim.value
          insert.run(claim.subject, 'claim', `${claim.key}: ${targetName}`, claim.source, `${targetName} ${claim.value}`)
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
    const phrase = `"${query.replaceAll('"', '""')}"`
    return this.index.prepare('SELECT kind, id, title, detail FROM records WHERE records MATCH ? ORDER BY rank LIMIT 100').all(phrase) as unknown as SearchResult[]
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const path = join(this.directories[3], `${id(conversation.id)}.yaml`)
    if (conversation.retained) {
      this.ephemeral.delete(conversation.id)
      await atomicWrite(path, YAML.stringify(conversation))
    } else {
      this.ephemeral.set(conversation.id, conversation)
      await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
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
    const proposal = data as unknown as Proposal
    if (accept) {
      const activeSubject = (await this.snapshot()).proposals.find((item) => item.id === proposalId)?.subject
      const entity = parseEntity(await readFile(join(this.directories[0], `${id(activeSubject)}.md`), 'utf8'))
      const subject = entity.id
      const claim: Claim = {
        id: randomUUID(), subject, key: requiredText(proposal.key, 'Key'),
        value: requiredText(proposal.value, 'Value'), source: requiredText(proposal.source, 'Source'),
        origin: proposal.origin, status: 'confirmed', recordedAt: new Date().toISOString()
      }
      await writeFile(join(this.directories[1], `${claim.id}.yaml`), YAML.stringify(claim), { flag: 'wx' })
      this.markDirty()
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
    const event = parseEvent({ ...value, id: value.id || randomUUID() })
    if (event.end && event.end < event.start) throw new Error('End date must follow start date')
    return this.saveModuleRecord(this.directories[5], { ...event, revision: value.revision })
  }

  async saveTask(value: TaskItem): Promise<WorkspaceSnapshot> {
    if (!(await this.snapshot()).modules.tasks) throw new Error('Tasks module is disabled')
    const task = parseTask({ ...value, id: value.id || randomUUID() })
    return this.saveModuleRecord(this.directories[6], { ...task, revision: value.revision })
  }
}
