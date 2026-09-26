import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { isWorkbenchView, parseLayout, removeFromLayout, splitLayout } from '../src/shared/layout'
import { parseResourceUri, resourceUri } from '../src/shared/resources'
import { activeTabOf, closeGroup, emptyGroup, enterView, focusedGroup, initialWorkbench, removeTab, nextGroupId, orderedGroups, pruneWorkbench, restoreWorkbench, showTab, showView, splitWorkbench, updateGroup, workbenchSession } from '../src/renderer/src/workbench-groups'

const parse = (value: unknown) => parseLayout(value, isWorkbenchView, (uri) => parseResourceUri(uri) !== null)

test('layout trees split beside a group, flatten same-direction splits, and collapse on removal', () => {
  const two = splitLayout({ group: 'a' }, 'a', 'b', 'row')
  assert.deepEqual(two, { split: 'row', children: [{ group: 'a' }, { group: 'b' }] })
  assert.deepEqual(splitLayout(two, 'a', 'c', 'row'), { split: 'row', children: [{ group: 'a' }, { group: 'c' }, { group: 'b' }] })
  assert.deepEqual(splitLayout(two, 'b', 'c', 'column'), { split: 'row', children: [{ group: 'a' }, { split: 'column', children: [{ group: 'b' }, { group: 'c' }] }] })
  assert.deepEqual(removeFromLayout(two, 'a'), { group: 'b' })
  assert.equal(removeFromLayout({ group: 'a' }, 'a'), null)
})

test('saved layouts are rejected unless every group appears exactly once within policy', () => {
  const groups = [{ id: 'main', view: 'knowledge', openUris: [] }, { id: 'group-2', view: 'home', openUris: ['serenity:page/home'], activeUri: 'serenity:page/home' }]
  const root = { split: 'row', children: [{ group: 'main' }, { group: 'group-2' }] }
  assert.ok(parse({ root, groups, focused: 'main' }))
  assert.equal(parse({ root, groups, focused: 'missing' }), null)
  assert.equal(parse({ root: { split: 'row', children: [{ group: 'main' }, { group: 'main' }] }, groups, focused: 'main' }), null)
  assert.equal(parse({ root, groups: [groups[0], { ...groups[1], view: 'shell' }], focused: 'main' }), null)
  assert.equal(parse({ root, groups: [groups[0], { ...groups[1], openUris: ['file:///etc/passwd'] }], focused: 'main' }), null)
  assert.equal(parse({ root: { split: 'row', children: [{ group: 'main' }, { group: 'group-2' }, { group: 'x' }] }, groups: [...groups, { id: 'x', view: 'home', openUris: [] }], focused: 'x' }), null, 'more groups than the current policy allows')
  assert.equal(parse({ root: { group: 'main', script: 'x' }, groups: [groups[0]], focused: 'main' }), null)
})

test('editor groups split, focus, close, and serialize as independent places', () => {
  const alex = { kind: 'entity' as const, id: 'alex' }
  const start = updateGroup(initialWorkbench, 'main', (group) => showTab(group, alex))
  const split = splitWorkbench(start)!
  assert.equal(split.groups.length, 2)
  assert.equal(split.focused, 'group-2')
  assert.deepEqual(activeTabOf(focusedGroup(split)), alex, 'a split shows the same resource as a second perspective')
  assert.equal(splitWorkbench(split), null, 'the group limit is enforced')
  const empty = splitWorkbench(start, { duplicate: false })!
  assert.equal(focusedGroup(empty).view, 'home')
  assert.equal(nextGroupId(split), 'main')
  const reviewing = updateGroup(split, 'group-2', (group) => showView(group, 'review'))
  assert.deepEqual(orderedGroups(reviewing).map((group) => group.view), ['knowledge', 'review'])
  const session = workbenchSession(reviewing, 'home')
  assert.equal(session.view, 'review', 'legacy fields mirror the focused group')
  assert.deepEqual(session.layout?.groups.map((group) => group.activeUri), [resourceUri(alex), undefined])
  const closed = closeGroup(reviewing, 'group-2')
  assert.equal(closed.groups.length, 1)
  assert.equal(closed.focused, 'main')
  assert.equal(closeGroup(closed, 'main'), closed, 'the last group stays open')
  assert.equal(workbenchSession(closed, 'home').layout, undefined)
})

test('a two-group session restores through the main process and drops unavailable resources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-layout-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const entity = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })).entities[0]
    await writeFile(join(directory, 'pages', 'Research.md'), '---\nid: research\ntitle: Research\nkind: page\n---\n# Research\n')
    workspace.markDirty()
    const alex = resourceUri({ kind: 'entity', id: entity.id })
    const research = resourceUri({ kind: 'page', id: 'research' })
    await workspace.saveSession({ view: 'home', openUris: [research], activeUri: research, layout: {
      root: { split: 'row', children: [{ group: 'main' }, { group: 'group-2' }] }, focused: 'group-2',
      groups: [{ id: 'main', view: 'knowledge', openUris: [alex, 'serenity:entity/gone'], activeUri: alex }, { id: 'group-2', view: 'home', openUris: [research], activeUri: research }]
    } })
    const session = (await workspace.loadSession())!
    assert.deepEqual(session.layout?.groups[0].openUris, [alex])
    const snapshot = await workspace.snapshot()
    const restored = restoreWorkbench(session, snapshot, () => true)
    assert.deepEqual(orderedGroups(restored).map((group) => activeTabOf(group)?.id), [entity.id, 'research'])
    assert.equal(restored.focused, 'group-2')
    await workspace.saveSession({ view: 'home', openUris: [], layout: { root: { group: 'main' }, groups: [], focused: 'main' } as never })
    assert.equal((await workspace.loadSession())?.layout, undefined, 'a damaged layout falls back to the single-group fields')
    const pruned = pruneWorkbench(restored, { ...snapshot, entities: [] }, () => true)
    assert.equal(activeTabOf(orderedGroups(pruned)[0]), undefined)
    assert.equal(pruneWorkbench(restored, snapshot, () => true), restored)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('returning to Knowledge resumes the last entity; choosing Knowledge again shows the library', () => {
  const alex = { kind: 'entity' as const, id: 'alex' }
  let group = showTab(emptyGroup('main'), alex)
  group = enterView(group, 'review')
  assert.equal(activeTabOf(group), undefined)
  group = enterView(group, 'knowledge')
  assert.deepEqual(activeTabOf(group), alex)
  group = enterView(group, 'knowledge')
  assert.equal(activeTabOf(group), undefined, 'the library')
  assert.equal(activeTabOf(enterView(enterView(group, 'review'), 'knowledge')), undefined, 'leaving from the library returns to it')
  assert.equal(enterView(removeTab(showTab(group, alex), 'entity:alex'), 'knowledge').activeTab, null, 'a closed tab is not resumed')
})
