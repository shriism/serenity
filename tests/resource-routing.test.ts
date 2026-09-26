import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { resourceUri } from '../src/shared/resources'
import { restoreTabs, routeResource, tabTitle } from '../src/renderer/src/resource-routing'
import type { View } from '../src/renderer/src/views'
import type { WorkspaceSnapshot } from '../src/shared/types'

const modulesOf = (snapshot: WorkspaceSnapshot) => (view: View): boolean =>
  (view !== 'calendar' || snapshot.modules.calendar) && (view !== 'tasks' || snapshot.modules.tasks)

test('resources route to their default view and respect availability', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-routing-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const entity = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '# Alex' })).entities[0]
    const claim = (await workspace.addClaim({ subject: entity.id, key: 'role', value: 'Teacher', source: 'Me' })).claims[0]
    const task = (await workspace.saveTask({ id: '', title: 'Call Alex', completed: false, notes: '', relatedEntityIds: [] })).tasks[0]
    await writeFile(join(directory, 'documents', 'notes.md'), '# Notes')
    await writeFile(join(directory, 'documents', 'photo.png'), 'not a real image')
    await writeFile(join(directory, 'pages', 'Research.md'), '---\nid: research\ntitle: Research\nkind: page\n---\n# Research\n')
    workspace.markDirty()
    let snapshot = await workspace.snapshot()
    const route = (kind: Parameters<typeof resourceUri>[0]['kind'], id: string) => routeResource(snapshot, resourceUri({ kind, id }), modulesOf(snapshot))

    assert.deepEqual(route('entity', entity.id), { action: 'tab', tab: { kind: 'entity', id: entity.id }, view: 'knowledge' })
    assert.deepEqual(route('claim', claim.id), route('entity', entity.id))
    assert.deepEqual(route('document', 'notes.md'), { action: 'tab', tab: { kind: 'document', id: 'notes.md' }, view: 'documents' })
    assert.deepEqual(route('document', 'photo.png'), { action: 'external', name: 'photo.png' })
    assert.deepEqual(route('page', 'home'), { action: 'home' })
    assert.deepEqual(route('page', 'research'), { action: 'tab', tab: { kind: 'page', id: 'research' }, view: 'home' })
    assert.deepEqual(route('task', task.id), { action: 'focus', kind: 'task', id: task.id, view: 'tasks' })
    assert.equal(route('entity', 'missing'), null)
    assert.equal(routeResource(snapshot, 'serenity:entity/../x', modulesOf(snapshot)), null)
    assert.equal(tabTitle(snapshot, { kind: 'page', id: 'research' }), 'Research')

    snapshot = await workspace.setModule('tasks', false)
    assert.equal(route('task', task.id), null)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('restored tabs keep saved order and drop missing, duplicate, or non-tab resources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-routing-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const snapshot = await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })
    const alex = resourceUri({ kind: 'entity', id: snapshot.entities[0].id })
    const tabs = restoreTabs(snapshot, [alex, 'serenity:page/home', 'serenity:document/gone.pdf', alex, 'not a uri'], () => true)
    assert.deepEqual(tabs, [{ kind: 'entity', id: snapshot.entities[0].id }])
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
