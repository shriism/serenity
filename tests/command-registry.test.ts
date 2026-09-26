import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Circle } from 'lucide-react'
import { Workspace } from '../src/main/workspace'
import { CommandRegistry, type CommandHost } from '../src/renderer/src/commands'

test('commands have one identity, availability check, and dispatch path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-commands-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const snapshot = await workspace.snapshot()
    const calls: string[] = []
    const host = { navigate: (view: string) => { calls.push(view); return true }, openResource: (uri: string) => { calls.push(uri); return true } } as CommandHost
    const custom = { id: 'example.action', title: 'Example action', icon: Circle, run: () => { calls.push('custom') } }
    const registry = new CommandRegistry(snapshot, [custom])
    assert.ok(registry.knownIds().has('page.open.home'))
    assert.ok(registry.list().some((command) => command.id === 'example.action'))
    assert.equal(registry.dispatch('example.action', host), true)
    assert.equal(registry.dispatch('page.open.home', host), true)
    assert.equal(registry.dispatch('missing', host), false)
    assert.deepEqual(calls, ['custom', 'serenity:page/home'])
    assert.throws(() => registry.register(custom), /already registered/)
    assert.throws(() => new CommandRegistry(snapshot, [{ ...custom, id: 'view.home' }]), /already registered/)
    assert.throws(() => registry.register({ ...custom, id: 'bad id' }), /Invalid command/)

    const disabled = new CommandRegistry({ ...snapshot, modules: { ...snapshot.modules, tasks: false } })
    assert.ok(disabled.knownIds().has('view.tasks'), 'a disabled module keeps its keybinding identity')
    assert.equal(disabled.get('view.tasks'), undefined)
    assert.equal(disabled.list().some((command) => command.id === 'view.tasks'), false)
    assert.equal(disabled.dispatch('view.tasks', host), false)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
