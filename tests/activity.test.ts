import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { activityDay, workspaceActivity } from '../src/shared/activity'

test('activity lists changes newest first with the record each concerns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-activity-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const alex = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })).entities[0]
    const club = (await workspace.saveEntity({ id: '', title: 'Club', type: 'group', body: '' })).entities.find((item) => item.title === 'Club')!
    const claim = (await workspace.addClaim({ subject: alex.id, key: 'member of', value: club.id, source: 'Me' })).claims[0]
    await workspace.setCurrentClaim(claim.id, 'Confirmed in person')
    const items = workspaceActivity(await workspace.snapshot())
    assert.deepEqual(items.map((item) => [item.kind, item.title]), [['resolution', 'Chose current member of for Alex'], ['claim', 'member of: Club']])
    assert.equal(items[1].uri, `serenity:entity/${alex.id}`)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('activity days read as Today, Yesterday, then dates', () => {
  const now = new Date('2026-09-26T12:00:00')
  assert.equal(activityDay('2026-09-26T08:00:00', now), 'Today')
  assert.equal(activityDay('2026-09-25T23:00:00', now), 'Yesterday')
  assert.match(activityDay('2026-09-01T10:00:00', now), /2026/)
  assert.equal(activityDay('', now), 'Date unknown')
})

test('identity decisions and their reversals remain visible in activity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-identity-activity-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const first = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })).entities[0]
    const second = (await workspace.saveEntity({ id: '', title: 'Alex M.', type: 'person', body: '' })).entities.find((item) => item.id !== first.id)!
    const decision = (await workspace.markDistinctEntities(first.id, second.id)).identityDecisions[0]
    await workspace.undoIdentityDecision(decision.id)
    const identity = workspaceActivity(await workspace.snapshot()).filter((item) => item.kind === 'identity')
    assert.equal(identity.length, 2)
    assert.ok(identity.some((item) => /^Marked Alex(?: M\.)? and Alex(?: M\.)? distinct$/.test(item.title)))
    assert.ok(identity.some((item) => item.title.startsWith('Reopened identity review for ')))
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
