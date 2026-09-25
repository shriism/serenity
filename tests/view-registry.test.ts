import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { ViewRegistry } from '../src/renderer/src/view-registry'

test('registered views render through contributions and respect disabled modules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-view-registry-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const registry = new ViewRegistry<{ workspace: Awaited<ReturnType<Workspace['snapshot']>> }>()
    const unregister = registry.register({ id: 'calendar', module: 'calendar', render: () => 'Calendar view' })
    assert.equal(registry.render('calendar', { workspace: await workspace.snapshot() }), 'Calendar view')
    assert.throws(() => registry.register({ id: 'calendar', render: () => 'Duplicate' }), /already registered/)
    await workspace.setModule('calendar', false)
    assert.equal(registry.render('calendar', { workspace: await workspace.snapshot() }), null)
    unregister()
    assert.equal(registry.has('calendar'), false)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
