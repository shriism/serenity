import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { dragDivider, isWorkbenchView, layoutGeometry, maxEditorGroups, parseLayout, removeFromLayout, splitLayout } from '../src/shared/layout'
import { parseResourceUri, resourceUri } from '../src/shared/resources'
import { activeTabOf, closeGroup, emptyGroup, enterView, findGroup, focusedGroup, initialWorkbench, moveTab, presentTab, removeTab, nextGroupId, orderedGroups, pruneWorkbench, restoreWorkbench, showTab, showView, splitWorkbench, updateGroup, workbenchSession } from '../src/renderer/src/workbench-groups'

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
  const many = Array.from({ length: maxEditorGroups + 1 }, (_, index) => `g${index}`)
  assert.equal(parse({ root: { split: 'row', children: many.map((id) => ({ group: id })) }, groups: many.map((id) => ({ id, view: 'home', openUris: [] })), focused: 'g0' }), null, 'more panes than the policy allows')
  assert.ok(parse({ root: { split: 'row', children: [{ group: 'main' }, { split: 'column', children: [{ group: 'group-2' }, { group: 'x' }] }] }, groups: [...groups, { id: 'x', view: 'home', openUris: [] }], focused: 'x' }), 'nested splits of several panes are valid')
  assert.equal(parse({ root: { group: 'main', script: 'x' }, groups: [groups[0]], focused: 'main' }), null)
})

test('editor groups split, focus, close, and serialize as independent places', () => {
  const alex = { kind: 'entity' as const, id: 'alex' }
  const start = updateGroup(initialWorkbench, 'main', (group) => showTab(group, alex))
  const split = splitWorkbench(start)!
  assert.equal(split.groups.length, 2)
  assert.equal(split.focused, 'group-2')
  assert.deepEqual(activeTabOf(focusedGroup(split)), alex, 'a split shows the same resource as a second perspective')
  let full = split
  while (full.groups.length < maxEditorGroups) full = splitWorkbench(full, { direction: full.groups.length % 2 ? 'column' : 'row' })!
  assert.equal(splitWorkbench(full), null, 'the pane cap is enforced')
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

test('split sizes stay valid through resizing, adding, removing, and restoring', async () => {
  const { normalizeSizes, resizeSplit, minSplitShare } = await import('../src/shared/layout')
  const close = (actual: number[] | undefined, expected: number[]) => assert.deepEqual(actual?.map((value) => Math.round(value * 1000) / 1000), expected)
  close(normalizeSizes([3, 1], 2), [0.75, 0.25])
  close(normalizeSizes([0.99, 0.01], 2), [1 - minSplitShare, minSplitShare])
  assert.equal(normalizeSizes([1, -1], 2), undefined)
  assert.equal(normalizeSizes([1], 2), undefined)
  const row = resizeSplit(splitLayout({ group: 'a' }, 'a', 'b', 'row'), [], [0.7, 0.3])
  close('split' in row ? row.sizes : undefined, [0.7, 0.3])
  const three = splitLayout(row, 'a', 'c', 'row')
  close('split' in three ? three.sizes : undefined, [0.35, 0.35, 0.3])
  const back = removeFromLayout(three, 'c')!
  close('split' in back ? back.sizes : undefined, [0.538, 0.462])
  assert.deepEqual(removeFromLayout(row, 'b'), { group: 'a' })
  const saved = parse({ root: { split: 'row', children: [{ group: 'main' }, { group: 'group-2' }], sizes: ['wide', 1] },
    groups: [{ id: 'main', view: 'home', openUris: [] }, { id: 'group-2', view: 'home', openUris: [] }], focused: 'main' })
  assert.ok(saved && 'split' in saved.root && saved.root.sizes === undefined, 'unusable sizes fall back to equal shares without discarding the layout')
})

test('pane geometry places every pane and divider, and dividers resize only their neighbors', () => {
  const root = { split: 'row' as const, sizes: [0.6, 0.4], children: [{ group: 'a' }, { split: 'column' as const, children: [{ group: 'b' }, { group: 'c' }] }] }
  const { groups, dividers } = layoutGeometry(root)
  assert.deepEqual(groups.get('a'), { x: 0, y: 0, width: 0.6, height: 1 })
  assert.deepEqual(groups.get('c'), { x: 0.6, y: 0.5, width: 0.4, height: 0.5 })
  assert.deepEqual(dividers.map((divider) => [divider.path, divider.index, divider.direction]), [[[], 1, 'row'], [[1], 1, 'column']])
  assert.deepEqual(dividers[1].line, { x: 0.6, y: 0.5, width: 0.4, height: 0 })
  assert.deepEqual(dragDivider([0.2, 0.3, 0.5], 2, 0.3), [0.2, 0.15, 0.65], 'the dragged pair keeps its total and the minimum share')
  assert.deepEqual(dragDivider([0.5, 0.5], 1, 0.7), [0.7, 0.30000000000000004])
  assert.deepEqual(splitLayout({ group: 'a' }, 'a', 'b', 'column', true), { split: 'column', children: [{ group: 'b' }, { group: 'a' }] }, 'a pane can be added before another')
})

test('tabs move between panes with their presentation, and closing a pane keeps the others', () => {
  const alex = { kind: 'entity' as const, id: 'alex' }
  let bench = updateGroup(initialWorkbench, 'main', (group) => presentTab(showTab(group, alex), 'entity:alex', 'timeline'))
  bench = splitWorkbench(bench, { duplicate: false, direction: 'column' })!
  const moved = moveTab(bench, 'main', 'entity:alex', 'group-2')
  assert.equal(moved.focused, 'group-2')
  assert.deepEqual(activeTabOf(focusedGroup(moved)), alex)
  assert.equal(focusedGroup(moved).presentations['entity:alex'], 'timeline')
  assert.equal(orderedGroups(moved)[0].tabs.length, 0)
  assert.equal(moveTab(moved, 'group-2', 'entity:alex', 'group-2'), moved, 'moving to the same pane changes nothing')
  const three = splitWorkbench(moved, { from: 'main', direction: 'row' })!
  assert.deepEqual(orderedGroups(closeGroup(three, 'group-2')).map((group) => group.id), ['main', 'group-3'])
})

test('a dropped tab lands before the tab it was dropped on, in the same pane or another', () => {
  const tab = (id: string) => ({ kind: 'page' as const, id })
  let bench = updateGroup(initialWorkbench, 'main', (group) => showTab(showTab(showTab(group, tab('a')), tab('b')), tab('c')))
  bench = moveTab(bench, 'main', 'page:c', 'main', 'page:a')
  assert.deepEqual(focusedGroup(bench).tabs.map((item) => item.id), ['c', 'a', 'b'])
  bench = updateGroup(splitWorkbench(bench, { duplicate: false })!, 'group-2', (group) => showTab(group, tab('x')))
  bench = moveTab(bench, 'main', 'page:b', 'group-2', 'page:x')
  assert.deepEqual(findGroup(bench, 'group-2')!.tabs.map((item) => item.id), ['b', 'x'])
  assert.equal(moveTab(bench, 'main', 'page:a', 'main', 'page:a'), bench)
})

test('directional focus finds the adjacent pane from the layout geometry', async () => {
  const { neighborGroup } = await import('../src/shared/layout')
  // a | (b over c), with d beside c
  const root = { split: 'row' as const, children: [{ group: 'a' }, { split: 'column' as const, children: [{ group: 'b' }, { split: 'row' as const, children: [{ group: 'c' }, { group: 'd' }] }] }] }
  const { groups } = layoutGeometry(root)
  assert.equal(neighborGroup(groups, 'a', 'right'), 'b', 'equal gaps prefer the larger overlap, then the first found')
  assert.equal(neighborGroup(groups, 'b', 'down'), 'c')
  assert.equal(neighborGroup(groups, 'd', 'up'), 'b')
  assert.equal(neighborGroup(groups, 'd', 'left'), 'c')
  assert.equal(neighborGroup(groups, 'c', 'left'), 'a')
  assert.equal(neighborGroup(groups, 'a', 'left'), null)
})
