import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { Workspace } from '../src/main/workspace'
import { buildSemanticIndex, rankSemanticIndex, readSemanticIndex } from '../src/main/semantic-index'
import { analyzeChangedDocument } from '../src/main/document-analysis'

test('workspace preserves file edits and prevents stale saves', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const created = await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '# Alex\nFrom AI Club.' })
    const entity = created.entities[0]
    assert.equal(entity.title, 'Alex')
    const path = join(directory, 'entities', `${entity.id}.md`)
    const original = await readFile(path, 'utf8')
    assert.match(original, /id: /)
    await writeFile(path, original.replace('title: Alex', 'title: Alex Chen'))
    const refreshed = await workspace.snapshot()
    assert.equal(refreshed.entities[0].title, 'Alex Chen')
    await assert.rejects(workspace.saveEntity({ ...entity, body: 'This is stale.' }), /changed on disk/)
    assert.match(await readFile(path, 'utf8'), /From AI Club/)
    await workspace.saveEntity({ ...refreshed.entities[0], body: 'Updated safely.' })
    assert.match(await readFile(path, 'utf8'), /Updated safely/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('conflicting claims remain sourced and proposals require review', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const { entities: [entity] } = await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })
    await workspace.addClaim({ subject: entity.id, key: 'birthday', value: 'September 7', source: 'Alex' })
    const other = await workspace.addClaim({ subject: entity.id, key: 'birthday', value: 'September 8', source: 'Old note' })
    assert.equal(other.claims.length, 2)
    await workspace.addProposal({
      id: '123e4567-e89b-42d3-a456-426614174000', kind: 'claim', subject: entity.id,
      key: 'hobby', value: 'Robotics', source: 'AI inference', origin: 'ai-inference',
      provider: 'copilot', conversationId: '123e4567-e89b-42d3-a456-426614174001',
      status: 'pending', recordedAt: new Date().toISOString()
    })
    const rejected = await workspace.resolveProposal('123e4567-e89b-42d3-a456-426614174000', false)
    assert.equal(rejected.claims.length, 2)
    assert.equal(rejected.proposals[0].status, 'rejected')
    const fromAlex = other.claims.find((item) => item.source === 'Alex')!
    const file = join(directory, 'claims', `${fromAlex.id}.yaml`)
    const claim = YAML.parse(await readFile(file, 'utf8'))
    assert.equal(claim.status, 'confirmed')
    assert.equal(claim.source, 'Alex')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('search index rebuilds after knowledge updates and can be recreated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    assert.deepEqual(await workspace.search('robotics'), [])
    const { entities: [entity] } = await workspace.saveEntity({ id: '', title: 'AI Club', type: 'community', body: 'We study robotics.' })
    assert.equal((await workspace.search('robotics'))[0].id, entity.id)
    workspace.close()
    await rm(join(directory, '.serenity'), { recursive: true })
    await workspace.initialize()
    assert.equal((await workspace.search('robotics'))[0].title, 'AI Club')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('conversation retention and accepting a proposal preserve claim provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const { entities: [entity] } = await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })
    const conversationId = '123e4567-e89b-42d3-a456-426614174002'
    await workspace.saveConversation({ id: conversationId, title: 'Alex', retained: true, messages: [{
      id: '123e4567-e89b-42d3-a456-426614174003', role: 'user', text: 'Alex likes robots', recordedAt: new Date().toISOString()
    }] })
    assert.equal((await workspace.snapshot()).conversations.length, 1)
    const stale = (await workspace.snapshot()).conversations[0]
    const conversationPath = join(directory, 'conversations', `${conversationId}.yaml`)
    await writeFile(conversationPath, (await readFile(conversationPath, 'utf8')).replace('title: Alex', 'title: Alex Chen'))
    await assert.rejects(workspace.saveConversation(stale), /changed on disk/)
    const proposalId = '123e4567-e89b-42d3-a456-426614174004'
    await workspace.addProposal({
      id: proposalId, kind: 'claim', subject: entity.id, key: 'interest', value: 'Robots', source: 'Conversation with me',
      origin: 'ai-inference', confidence: 0.65, provider: 'copilot', conversationId, status: 'pending', recordedAt: new Date().toISOString()
    })
    const accepted = await workspace.resolveProposal(proposalId, true)
    assert.equal(accepted.claims[0].origin, 'ai-inference')
    assert.equal(accepted.claims[0].confidence, 0.65)
    assert.equal(accepted.claims[0].source, 'Conversation with me')
    assert.equal(accepted.proposals[0].status, 'accepted')
    await workspace.deleteConversation(conversationId)
    assert.equal((await workspace.snapshot()).conversations.length, 0)
    assert.equal((await workspace.snapshot()).claims.length, 1)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('calendar and tasks remain on disk when their modules are disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const { entities: [entity] } = await workspace.saveEntity({ id: '', title: 'Project', type: 'project', body: '' })
    const withEvent = await workspace.saveEvent({ id: '', title: 'Meet', start: '2026-10-04T10:00', notes: '', relatedEntityIds: [entity.id] })
    assert.equal(withEvent.events[0].relatedEntityIds[0], entity.id)
    await assert.rejects(workspace.saveEvent({ id: '', title: 'Invalid', start: '2026-02-30', notes: '', relatedEntityIds: [] }), /Invalid start date/)
    const withTask = await workspace.saveTask({ id: '', title: 'Prepare', due: '2026-10-03', completed: false, notes: '', relatedEntityIds: [entity.id] })
    assert.equal(withTask.tasks.length, 1)
    assert.equal((await workspace.search('Prepare'))[0].kind, 'task')
    assert.equal((await workspace.search('Meet'))[0].kind, 'event')
    const disabled = await workspace.setModule('calendar', false)
    assert.equal(disabled.modules.calendar, false)
    assert.equal(disabled.events.length, 1)
    assert.equal((await workspace.search('Meet')).length, 0)
    await assert.rejects(workspace.saveEvent({ id: '', title: 'Blocked', start: '2026-10-05', notes: '', relatedEntityIds: [] }), /disabled/)
    const secondInstance = new Workspace(directory)
    await secondInstance.initialize()
    assert.equal((await secondInstance.snapshot()).modules.calendar, false)
    assert.equal((await secondInstance.snapshot()).events.length, 1)
    workspace.close()
    secondInstance.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('merge archives duplicate and resolves knowledge and module links without erasing claim files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const { entities: [duplicate] } = await workspace.saveEntity({ id: '', title: 'Alex from club', type: 'person', body: 'Old context.' })
    const { entities } = await workspace.saveEntity({ id: '', title: 'Alex Chen', type: 'person', body: 'Updated context.' })
    const target = entities.find((item) => item.id !== duplicate.id)!
    await workspace.addClaim({ subject: duplicate.id, key: 'interest', value: 'Robotics', source: 'Chat' })
    await workspace.addClaim({ subject: target.id, key: 'friend of', value: duplicate.id, source: 'Me' })
    await workspace.saveTask({ id: '', title: 'Meet Alex', completed: false, notes: '', relatedEntityIds: [duplicate.id] })
    const merged = await workspace.mergeEntities(duplicate.id, target.id)
    assert.equal(merged.entities.length, 1)
    assert.equal(merged.claims.find((item) => item.key === 'interest')?.subject, target.id)
    assert.equal(merged.claims.find((item) => item.key === 'friend of')?.value, target.id)
    assert.equal(merged.tasks[0].relatedEntityIds[0], target.id)
    assert.equal(merged.merges[0].title, 'Alex from club')
    assert.equal(merged.archivedEntities[0].body, 'Old context.')
    assert.match(await readFile(join(directory, 'archive', 'entities', `${duplicate.id}.md`), 'utf8'), /Old context/)
    assert.equal((await workspace.snapshot()).claims.length, 2)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('opt-in semantic indexing sends changed records only and retains a rebuildable summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    await workspace.saveEntity({ id: '', title: 'Robotics', type: 'concept', body: 'Machines that move.' })
    let sent = 0
    const ask = async () => { sent++; return '{"summary":"A concept about moving machines.","terms":["robots","engineering"]}' }
    await buildSemanticIndex(workspace, ask)
    assert.equal(sent, 0)
    await workspace.setModule('semanticIndex', true)
    await buildSemanticIndex(workspace, ask)
    assert.equal(sent, 1)
    assert.equal((await readSemanticIndex(workspace))?.entries.length, 1)
    assert.equal((await rankSemanticIndex(workspace, 'engineering'))[0].title, 'Robotics')
    await buildSemanticIndex(workspace, ask)
    assert.equal(sent, 1)
    const entity = (await workspace.snapshot()).entities[0]
    await workspace.saveEntity({ ...entity, body: 'New context about robots.' })
    await buildSemanticIndex(workspace, ask)
    assert.equal(sent, 2)
    assert.equal((await workspace.snapshot()).semanticIndex?.count, 1)
    await workspace.setModule('semanticIndex', false)
    assert.deepEqual(await rankSemanticIndex(workspace, 'engineering'), [])
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('retracting a claim preserves its origin while excluding it from current search', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const { entities: [entity] } = await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })
    const { claims: [claim] } = await workspace.addClaim({ subject: entity.id, key: 'interest', value: 'Robotics', source: 'Alex said' })
    assert.equal((await workspace.search('Robotics')).length, 1)
    const updated = await workspace.retractClaim(claim.id, 'Alex corrected this')
    assert.equal(updated.claims[0].status, 'retracted')
    assert.equal(updated.claims[0].source, 'Alex said')
    assert.equal(updated.claims[0].retractionReason, 'Alex corrected this')
    assert.equal((await workspace.search('Robotics')).length, 0)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('accepted AI proposals create sourced entities, tasks, and events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const common = { provider: 'copilot' as const, conversationId: '123e4567-e89b-42d3-a456-426614174011', status: 'pending' as const, recordedAt: new Date().toISOString(), source: 'Syllabus', origin: 'ai-statement' as const }
    const entityId = '123e4567-e89b-42d3-a456-426614174012'
    await workspace.addProposal({ ...common, kind: 'entity', id: entityId, title: 'Research Club', type: 'community', body: 'A group.' })
    const accepted = await workspace.resolveProposal(entityId, true)
    assert.equal(accepted.entities[0].source, 'Syllabus')
    assert.equal(accepted.entities[0].origin, 'ai-statement')
    const taskId = '123e4567-e89b-42d3-a456-426614174013'
    await workspace.addProposal({ ...common, kind: 'task', id: taskId, title: 'Apply', due: '2026-10-04', notes: '', relatedEntityIds: [accepted.entities[0].id] })
    assert.equal((await workspace.resolveProposal(taskId, true)).tasks[0].source, 'Syllabus')
    const eventId = '123e4567-e89b-42d3-a456-426614174014'
    await workspace.addProposal({ ...common, kind: 'event', id: eventId, title: 'Meeting', start: '2026-10-10T11:00', notes: '', relatedEntityIds: [accepted.entities[0].id] })
    const after = await workspace.resolveProposal(eventId, true)
    assert.equal(after.events[0].title, 'Meeting')
    assert.equal(after.proposals.filter((proposal) => proposal.status === 'accepted').length, 3)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('automatic document analysis is opt-in and runs once per document version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-test-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const document = join(directory, 'documents', 'notes.txt')
    await writeFile(document, 'Meeting on Tuesday')
    let analyzed = 0
    const send = async () => { analyzed++; return workspace.snapshot() }
    await analyzeChangedDocument(workspace, 'notes.txt', send)
    assert.equal(analyzed, 0)
    await workspace.setModule('documentAnalysis', true)
    await analyzeChangedDocument(workspace, 'notes.txt', send)
    await analyzeChangedDocument(workspace, 'notes.txt', send)
    assert.equal(analyzed, 1)
    await writeFile(document, 'Meeting on Wednesday')
    await analyzeChangedDocument(workspace, 'notes.txt', send)
    assert.equal(analyzed, 2)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
