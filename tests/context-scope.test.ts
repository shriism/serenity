import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { contextRecords, prepareContext, scopeContextRecords } from '../src/main/context'
import { validateReadScope } from '../src/shared/workflow'

test('selected read scope excludes other entities and documents even when search finds them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-scope-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const first = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: 'Birthday September 7' })).entities[0]
    const second = (await workspace.saveEntity({ id: '', title: 'Private Project', type: 'project', body: 'Secret code violet nebula' })).entities.find((entity) => entity.id !== first.id)!
    await workspace.addClaim({ subject: first.id, key: 'birthday', value: 'September 7', source: 'Alex' })
    await workspace.addClaim({ subject: second.id, key: 'password hint', value: 'violet nebula', source: 'Private note' })
    const snapshot = await workspace.snapshot()
    const all = contextRecords(snapshot, [{ name: 'private.txt', text: 'violet nebula document' }])
    const scope = validateReadScope({ mode: 'selected', entityIds: [first.id], documentNames: [],
      includeOtherConversations: false, includeCalendarAndTasks: false })
    const permitted = scopeContextRecords(snapshot, all, scope)
    assert.equal(permitted.some((record) => record.ref === `entity:${first.id}`), true)
    assert.equal(permitted.some((record) => record.ref === `entity:${second.id}`), false)
    assert.equal(permitted.some((record) => record.ref === 'document:private.txt'), false)
    assert.equal(permitted.filter((record) => record.ref.startsWith('claim:')).length, 1)
    const foundOutside = await workspace.search('violet nebula')
    assert.ok(foundOutside.length > 0)
    const prepared = prepareContext(permitted, 'violet nebula', foundOutside)
    assert.ok(!prepared.text.includes('Private Project'))
    assert.ok(!prepared.text.includes('violet nebula document'))
    assert.ok(!prepared.text.includes(second.id))
    assert.deepEqual(validateReadScope(undefined).mode, 'workspace')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('an open permitted document is sent first when the workspace needs retrieval', () => {
  const records = [
    { ref: 'document:notes.md', title: 'notes.md', text: 'Open notes about the robotics club' },
    { ref: 'entity:other', title: 'Archive', text: 'Unrelated text. '.repeat(15000) }
  ]
  const prepared = prepareContext(records, 'What should I do next?', [], ['document:notes.md'])
  assert.equal(prepared.shared.mode, 'retrieved')
  assert.equal(prepared.shared.records[0].ref, 'document:notes.md')
  assert.match(prepared.text, /robotics club/)
})
