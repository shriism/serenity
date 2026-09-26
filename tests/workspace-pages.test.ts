import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
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
    const conversation = { id: '123e4567-e89b-42d3-a456-426614174015', title: 'Working together', messages: [], retained: true }
    await first.saveConversation(conversation)
    const assistantUri = resourceUri({ kind: 'conversation', id: conversation.id })
    await first.saveSession({ view: 'knowledge', activeUri: ref, assistantUri, openUris: [ref, 'serenity:document/missing.pdf'] })
    first.close()
    const reopened = new Workspace(directory)
    await reopened.initialize()
    assert.deepEqual(await reopened.loadSession(), { view: 'knowledge', activeUri: ref, assistantUri, openUris: [ref] })
    await assert.rejects(reopened.saveSession({ view: 'untrusted', openUris: [] }), /Invalid workspace session/)
    reopened.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('overlapping session saves retain the latest requested layout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-session-order-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const snapshot = workspace.snapshot.bind(workspace)
    let calls = 0
    workspace.snapshot = async () => {
      if (++calls === 1) await new Promise<void>((resolve) => setTimeout(resolve, 100))
      return snapshot()
    }
    await Promise.all([
      workspace.saveSession({ view: 'home', openUris: [] }),
      workspace.saveSession({ view: 'knowledge', openUris: [] })
    ])
    assert.equal((await workspace.loadSession())?.view, 'knowledge')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a damaged session is preserved and a fresh session can be saved', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-session-recovery-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const settings = join(directory, '.serenity')
    const path = join(settings, 'session.yaml')
    for (const damaged of ['view: [unterminated', 'view: unknown\nopenUris: []\n']) {
      await writeFile(path, damaged)
      assert.equal(await workspace.loadSession(), null)
      const archived = (await readdir(settings)).filter((name) => name.startsWith('session.yaml.corrupt-'))
      assert.equal(archived.length, damaged.startsWith('view: [') ? 1 : 2)
      assert.ok((await Promise.all(archived.map((name) => readFile(join(settings, name), 'utf8')))).includes(damaged))
    }
    await workspace.saveSession({ view: 'home', openUris: [] })
    assert.deepEqual(await workspace.loadSession(), { view: 'home', openUris: [], activeUri: undefined })
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('correcting damaged module and provider settings keeps their original files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-settings-recovery-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const settings = join(directory, '.serenity')
    const invalidModules = 'calendar: [unfinished'
    const invalidProvider = 'provider: discontinued\n'
    await writeFile(join(settings, 'modules.yaml'), invalidModules)
    await writeFile(join(settings, 'semantic-provider.yaml'), invalidProvider)
    await workspace.setModule('calendar', false)
    await workspace.setSemanticProvider('codex')
    const names = await readdir(settings)
    const preserved = async (prefix: string): Promise<string> => {
      const archive = names.find((name) => name.startsWith(`${prefix}.corrupt-`))
      assert.ok(archive)
      return readFile(join(settings, archive), 'utf8')
    }
    assert.equal(await preserved('modules.yaml'), invalidModules)
    assert.equal(await preserved('semantic-provider.yaml'), invalidProvider)
    assert.equal((await workspace.snapshot()).modules.calendar, false)
    assert.equal((await workspace.snapshot()).semanticProvider, 'codex')
    workspace.close()
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

test('page queries can select by document source and list recent activity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-query-source-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const course = (await workspace.saveEntity({ id: '', title: 'CS 101', type: 'course', body: '' })).entities[0]
    await workspace.addClaim({ subject: course.id, key: 'midterm', value: 'October 12', source: 'syllabus.pdf, p. 2' })
    await workspace.addClaim({ subject: course.id, key: 'room', value: 'B12', source: 'Registrar email' })
    const snapshot = await workspace.snapshot()
    assert.deepEqual(evaluateWorkspaceQuery(snapshot, { from: 'claims', where: { source: 'syllabus.pdf' } }).items.map((item) => item.title), ['CS 101 · midterm'])
    const recent = evaluateWorkspaceQuery(snapshot, { from: 'activity', where: { kind: 'claim' }, limit: 5 })
    assert.equal(recent.items.length, 2)
    assert.equal(parseResourceUri(recent.items[0].uri)?.kind, 'entity')
    assert.throws(() => evaluateWorkspaceQuery(snapshot, { from: 'activity', where: { title: 'x' } }), /Unsupported activity filter/)
    assert.throws(() => evaluateWorkspaceQuery(snapshot, { from: 'claims', where: { source: 3 } }), /Unsupported claims filter/)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
