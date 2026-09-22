import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { Workspace } from '../src/main/workspace'

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
      id: '123e4567-e89b-42d3-a456-426614174000', subject: entity.id,
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
    const proposalId = '123e4567-e89b-42d3-a456-426614174004'
    await workspace.addProposal({
      id: proposalId, subject: entity.id, key: 'interest', value: 'Robots', source: 'Conversation with me',
      origin: 'ai-inference', provider: 'copilot', conversationId, status: 'pending', recordedAt: new Date().toISOString()
    })
    const accepted = await workspace.resolveProposal(proposalId, true)
    assert.equal(accepted.claims[0].origin, 'ai-inference')
    assert.equal(accepted.claims[0].source, 'Conversation with me')
    assert.equal(accepted.proposals[0].status, 'accepted')
    await workspace.deleteConversation(conversationId)
    assert.equal((await workspace.snapshot()).conversations.length, 0)
    assert.equal((await workspace.snapshot()).claims.length, 1)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
