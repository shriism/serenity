import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { Workspace } from '../src/main/workspace'
import { eventKeybinding, formatKeybinding, normalizeKeybinding, resolveKeymap } from '../src/shared/keybindings'

const key = (init: Partial<Parameters<typeof eventKeybinding>[0]>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init })

test('keybindings normalize to one spelling and refuse chords that would capture typing', () => {
  assert.equal(normalizeKeybinding('shift+mod+k'), 'Mod+Shift+K')
  assert.equal(normalizeKeybinding('Alt + arrowup'), 'Alt+ArrowUp')
  assert.equal(normalizeKeybinding('F5'), 'F5')
  assert.equal(normalizeKeybinding('K'), null)
  assert.equal(normalizeKeybinding('Shift+K'), null)
  assert.equal(normalizeKeybinding('Mod+Mod+K'), null)
  assert.equal(normalizeKeybinding('Hyper+K'), null)
  assert.equal(normalizeKeybinding('Mod+'), null)
})

test('keyboard events map to the same chord on each platform', () => {
  assert.equal(eventKeybinding(key({ key: 'k', code: 'KeyK', metaKey: true }), true), 'Mod+K')
  assert.equal(eventKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true }), false), 'Mod+K')
  assert.equal(eventKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true }), true), 'Ctrl+K')
  assert.equal(eventKeybinding(key({ key: '˚', code: 'KeyK', metaKey: true, altKey: true }), true), 'Mod+Alt+K')
  assert.equal(eventKeybinding(key({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), false), 'Mod+Shift+1')
  assert.equal(eventKeybinding(key({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true), null)
  assert.equal(formatKeybinding('Mod+Shift+K', true), '⌘⇧K')
  assert.equal(formatKeybinding('Mod+Shift+K', false), 'Ctrl+Shift+K')
})

test('a workspace keymap replaces, removes, and reports conflicting bindings', () => {
  const defaults = [{ id: 'search', keybinding: 'Mod+K' }, { id: 'nav', keybinding: 'Mod+B' }, { id: 'new' }, { id: 'page' }]
  const keymap = resolveKeymap(defaults, { new: 'Mod+K', nav: null, page: 'Mod+K', missing: 'Mod+M', search: 'banana' })
  assert.equal(keymap.bindings.get('Mod+K'), 'new', 'a workspace chord displaces a built-in default')
  assert.equal(keymap.byCommand.has('search'), false)
  assert.equal(keymap.byCommand.has('nav'), false)
  assert.equal(keymap.byCommand.has('page'), false)
  assert.deepEqual(keymap.problems, [
    'Mod+K is bound to both new and page; new keeps it',
    'Keybinding for unknown command missing',
    'Invalid keybinding for search: banana'
  ])
  assert.deepEqual(resolveKeymap(defaults).problems, [])
})

test('workbench YAML keybindings are validated by the main process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-keys-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const config = join(directory, '.serenity', 'workbench.yaml')
    const base = YAML.parse(await readFile(config, 'utf8'))
    await writeFile(config, YAML.stringify({ ...base, keybindings: { 'entity.create': 'mod+shift+e', 'assistant.toggle': null } }))
    let snapshot = await workspace.snapshot()
    assert.deepEqual(snapshot.workbench.keybindings, { 'entity.create': 'mod+shift+e', 'assistant.toggle': null })
    assert.deepEqual(snapshot.errors, [])
    await writeFile(config, YAML.stringify({ ...base, keybindings: { 'entity.create': 'E' } }))
    snapshot = await workspace.snapshot()
    assert.equal(snapshot.workbench.keybindings, undefined)
    assert.deepEqual(snapshot.workbench.navigation, base.navigation, 'a bad keymap does not discard navigation')
    assert.ok(snapshot.errors.some((error) => error.includes('Invalid keybindings')))
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
