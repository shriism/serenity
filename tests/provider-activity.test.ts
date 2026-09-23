import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { trackProviderCall } from '../src/main/provider-activity'

test('provider activity records references without duplicating private prompt text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-activity-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const response = await trackProviderCall(directory, 'copilot', 'Private question for Alex',
      { operation: 'conversation', refs: ['entity:alex-id'] }, async () => 'answer')
    assert.equal(response, 'answer')
    const entries = (await workspace.snapshot()).providerActivity
    assert.equal(entries.length, 1)
    assert.equal(entries[0].status, 'completed')
    assert.deepEqual(entries[0].refs, ['entity:alex-id'])
    assert.equal(entries[0].promptCharacters, 'Private question for Alex'.length)
    const stored = await readFile(join(directory, 'activity', `${entries[0].id}.yaml`), 'utf8')
    assert.ok(!stored.includes('Private question for Alex'))
    await assert.rejects(trackProviderCall(directory, 'codex', 'Second private prompt',
      { operation: 'semantic-search', refs: [] }, async () => { throw new Error('provider offline') }), /provider offline/)
    assert.equal((await workspace.snapshot()).providerActivity.find((entry) => entry.provider === 'codex')?.status, 'failed')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
