import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import YAML from 'yaml'
import { evaluateWorkspaceQuery } from '../src/shared/query'
import { parseResourceUri, resourceUri, workspaceResources } from '../src/shared/resources'

test('authored pages remain inside the workspace and reject stale or unrelated edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-pages-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const page = (await workspace.snapshot()).pages.find((item) => item.id === 'home')!
    assert.equal(page.path, 'pages/Home.md')
    assert.match(page.text, /```serenity-query/)
    const edited = page.text.replace('# Your world, in context', '# My own workspace')
    await workspace.savePage({ ...page, text: edited })
    assert.match(await readFile(join(directory, page.path), 'utf8'), /# My own workspace/)
    await assert.rejects(workspace.savePage({ ...page, text: '---\nid: home\ntitle: Home\nkind: page\n---\nOld edit' }), /changed on disk/)
    await assert.rejects(workspace.savePage({ ...page, path: '../outside.md', text: edited }), /not found in this workspace/)
    const refreshed = (await workspace.snapshot()).pages[0]
    assert.equal(refreshed.body.includes('My own workspace'), true)
    assert.ok(workspaceResources(await workspace.snapshot()).some((item) => item.uri === 'serenity:page/home' && item.path === 'pages/Home.md'))
    const created = (await workspace.createPage()).pages.find((item) => item.id !== 'home')!
    assert.match(created.id, /^page-[a-f0-9-]{36}$/)
    assert.equal(created.path, `pages/${created.id}.md`)
    assert.match(await readFile(join(directory, created.path), 'utf8'), /kind: page/)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('bounded queries select real workspace records and reject unknown operations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-query-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const entity = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '# Alex' })).entities[0]
    const due = new Date(Date.now() + 86400000).toLocaleDateString('en-CA')
    await workspace.saveTask({ id: '', title: 'Call Alex', due, completed: false, notes: '', relatedEntityIds: [entity.id] })
    const snapshot = await workspace.snapshot()
    const result = evaluateWorkspaceQuery(snapshot, { from: 'upcoming', limit: 5 })
    assert.equal(result.items[0].title, 'Call Alex')
    assert.equal(parseResourceUri(result.items[0].uri)?.kind, 'task')
    assert.deepEqual(evaluateWorkspaceQuery(snapshot, { from: 'entities', where: { type: 'person' } }).items.map((item) => item.title), ['Alex'])
    assert.throws(() => evaluateWorkspaceQuery(snapshot, { from: 'tasks', where: { script: 'delete everything' } }), /Unsupported tasks filter/)
    assert.throws(() => evaluateWorkspaceQuery(snapshot, { from: 'entities', limit: 100000 }), /limit must be between/)
    assert.equal(parseResourceUri('serenity:document/..'), null)
    assert.equal(parseResourceUri(resourceUri({ kind: 'document', id: 'notes.pdf' }))?.id, 'notes.pdf')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('workspace-owned workbench YAML chooses a page and declares navigation groups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-layout-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    await writeFile(join(directory, 'pages', 'Research.md'), '---\nid: research\ntitle: Research\nkind: page\n---\n# Research notebook\n')
    const config = join(directory, '.serenity', 'workbench.yaml')
    await writeFile(config, YAML.stringify({ homePage: 'research', navigation: [{ group: 'My space', commands: ['view.home', 'page.open.home', 'view.knowledge'] }] }))
    const snapshot = await workspace.snapshot()
    assert.equal(snapshot.workbench.homePage, 'research')
    assert.deepEqual(snapshot.workbench.navigation[0].commands, ['view.home', 'page.open.home', 'view.knowledge'])
    assert.equal(snapshot.pages.length, 2)
    await writeFile(config, YAML.stringify({ homePage: 'missing', navigation: [] }))
    const broken = await workspace.snapshot()
    assert.ok(broken.errors.some((error) => error.includes('workbench.yaml')))
    assert.equal(broken.workbench.homePage, 'home')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the last open resource is restored from workspace-local session metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-session-'))
  try {
    const first = new Workspace(directory)
    await first.initialize()
    assert.equal(await first.loadSession(), null)
    const entity = (await first.saveEntity({ id: '', title: 'Alex', type: 'person', body: 'Notes' })).entities[0]
    const ref = resourceUri({ kind: 'entity', id: entity.id })
    await first.saveSession({ view: 'knowledge', activeUri: ref, openUris: [ref, 'serenity:document/missing.pdf'] })
    first.close()
    const reopened = new Workspace(directory)
    await reopened.initialize()
    assert.deepEqual(await reopened.loadSession(), { view: 'knowledge', activeUri: ref, openUris: [ref] })
    await assert.rejects(reopened.saveSession({ view: 'untrusted', openUris: [] }), /Invalid workspace session/)
    reopened.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a linked Home page cannot read or rewrite content outside the workspace', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-pages-'))
  const outside = await mkdtemp(join(tmpdir(), 'serenity-external-page-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const external = join(outside, 'Home.md')
    await writeFile(external, 'Outside content')
    await rm(join(directory, 'pages', 'Home.md'))
    await symlink(external, join(directory, 'pages', 'Home.md'))
    const snapshot = await workspace.snapshot()
    assert.equal(snapshot.pages.some((item) => item.id === 'home'), false)
    assert.ok(snapshot.errors.some((error) => error.includes('pages/Home.md')))
    assert.equal(await readFile(external, 'utf8'), 'Outside content')
    workspace.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
