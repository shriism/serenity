import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { entityConnections, entityHistory } from '../src/shared/entity-history'

async function world() {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-history-'))
  const workspace = new Workspace(directory)
  await workspace.initialize()
  const create = async (title: string, type: string) => (await workspace.saveEntity({ id: '', title, type, body: '' })).entities.find((item) => item.title === title)!
  const alex = await create('Alex', 'person')
  const club = await create('Robotics Club', 'group')
  const sam = await create('Sam', 'person')
  const duplicate = await create('Alex M.', 'person')
  return { directory, workspace, alex, club, sam, duplicate }
}

test('an entity timeline keeps corrections and decisions beside what they changed', async () => {
  const { directory, workspace, alex, club, duplicate } = await world()
  try {
    await workspace.addClaim({ subject: alex.id, key: 'member of', value: club.id, source: 'Me' })
    const first = (await workspace.addClaim({ subject: alex.id, key: 'birthday', value: 'September 7', source: 'Alex' })).claims.find((item) => item.value === 'September 7')!
    const second = (await workspace.addClaim({ subject: alex.id, key: 'birthday', value: 'September 8', source: 'Old card' })).claims.find((item) => item.value === 'September 8')!
    await workspace.retractClaim(second.id, 'The card was wrong')
    await workspace.setCurrentClaim(first.id, 'Alex told me directly')
    await workspace.addClaim({ subject: duplicate.id, key: 'email', value: 'alex@example.com', source: 'Contacts' })
    await workspace.mergeEntities(duplicate.id, alex.id)
    await workspace.saveTask({ id: '', title: 'Call Alex', due: '2999-01-01', completed: false, notes: '', relatedEntityIds: [alex.id] })
    const history = entityHistory(await workspace.snapshot(), alex.id, '2026-01-01T00:00:00.000Z')
    const titles = history.map((entry) => entry.title)
    assert.ok(titles.includes('Recorded member of: Robotics Club'), 'entity-valued claims read as the related entity')
    assert.ok(titles.includes('Retracted birthday: September 8'))
    assert.ok(titles.includes('Recorded birthday: September 8'), 'the corrected claim stays in the record')
    assert.equal(history.find((entry) => entry.kind === 'resolution')?.detail, 'Alex told me directly')
    assert.ok(titles.includes('Merged Alex M. into this entity'))
    assert.equal(history.find((entry) => entry.title === 'Recorded email: alex@example.com')?.detail, 'Carried over from Alex M.')
    const task = history.find((entry) => entry.kind === 'task')!
    assert.equal(task.upcoming, true)
    assert.equal(history[0], task, 'newest first, with scheduled items ahead')
    assert.equal(entityHistory(await workspace.setModule('tasks', false), alex.id).some((entry) => entry.kind === 'task'), false, 'disabled modules stay out')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('connections follow confirmed claims both ways and shared records, with further reach', async () => {
  const { directory, workspace, alex, club, sam } = await world()
  try {
    await workspace.addClaim({ subject: alex.id, key: 'member of', value: club.id, source: 'Me' })
    await workspace.addClaim({ subject: sam.id, key: 'member of', value: club.id, source: 'Me' })
    const wrong = (await workspace.addClaim({ subject: alex.id, key: 'sibling of', value: sam.id, source: 'Rumor' })).claims.find((item) => item.key === 'sibling of')!
    await workspace.retractClaim(wrong.id, 'Not true')
    await workspace.saveEvent({ id: '', title: 'Hackathon', start: '2026-10-01T10:00', notes: '', relatedEntityIds: [alex.id, sam.id] })
    const snapshot = await workspace.snapshot()
    const fromAlex = entityConnections(snapshot, alex.id)
    assert.deepEqual(fromAlex.map((item) => item.title).sort(), ['Robotics Club', 'Sam'])
    const toSam = fromAlex.find((item) => item.title === 'Sam')!
    assert.deepEqual(toSam.links.map((link) => [link.via, link.direction, link.key]), [['event', 'shared', 'Hackathon']], 'retracted claims do not connect')
    assert.equal(fromAlex.find((item) => item.title === 'Robotics Club')!.further, 1, 'the club also connects to Sam')
    const fromClub = entityConnections(snapshot, club.id)
    assert.deepEqual(fromClub.flatMap((item) => item.links.map((link) => link.direction)), ['in', 'in'])
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('timeline titles summarize long or Markdown values as plain text', async () => {
  const { plainSummary } = await import('../src/shared/entity-history')
  assert.equal(plainSummary('Met at **robotics club**. See [notes](x.md).'), 'Met at robotics club. See notes.')
  assert.equal(plainSummary('a'.repeat(200), 10), `${'a'.repeat(9)}…`)
})
