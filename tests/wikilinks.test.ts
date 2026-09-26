import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkWikilinks, pageOutgoingLinks, resolveWikilink } from '../src/shared/wikilinks'
import type { WorkspaceSnapshot } from '../src/shared/types'

const snapshot = {
  pages: [{ id: 'research', title: 'Research', path: '', body: '', text: '', revision: '' }],
  entities: [{ id: 'e1', title: 'Alex', type: 'person', body: '' }, { id: 'e2', title: 'Sam', type: 'person', body: '' }, { id: 'e3', title: 'Sam', type: 'dog', body: '' }],
  documents: [{ name: 'syllabus.pdf', size: 1, extractable: true }]
}
const resolve = (target: string) => resolveWikilink(snapshot, target)

test('wikilinks resolve by exact title across pages, entities, and documents', () => {
  assert.deepEqual(resolve(' alex '), { kind: 'resolved', uri: 'serenity:entity/e1', title: 'Alex (person)' })
  assert.deepEqual(resolve('Research'), { kind: 'resolved', uri: 'serenity:page/research', title: 'Research' })
  assert.deepEqual(resolve('syllabus'), { kind: 'resolved', uri: 'serenity:document/syllabus.pdf', title: 'syllabus.pdf' })
  assert.deepEqual(resolve('Sam'), { kind: 'ambiguous', titles: ['Sam (person)', 'Sam (dog)'] })
  assert.deepEqual(resolve('Nobody'), { kind: 'missing' })
})

test('wikilinks become Markdown links outside code, keeping labels and leaving embeds alone', () => {
  const text = 'Met [[Alex|my friend]] and [[Sam]] about [[Research#Plan]].\n`[[Alex]]` stays, ![[syllabus.pdf]] too.\n```\n[[Alex]]\n```\nSee [[Nobody]].'
  assert.equal(linkWikilinks(text, resolve), 'Met [my friend](serenity:entity/e1) and [Sam](serenity-wikilink:ambiguous/Sam%20%28person%29%20%C2%B7%20Sam%20%28dog%29) about [Research](serenity:page/research).\n' +
    '`[[Alex]]` stays, ![[syllabus.pdf]] too.\n```\n[[Alex]]\n```\nSee [Nobody](serenity-wikilink:missing/Nobody).')
})

test('backlinks list the pages and notes whose wikilinks resolve to a resource', async () => {
  const { wikilinkMentions } = await import('../src/shared/wikilinks')
  const withNotes = { ...snapshot,
    pages: [{ ...snapshot.pages[0], body: 'Plan:\nMeet [[alex]] on Friday.' }],
    entities: [...snapshot.entities, { id: 'e4', title: 'Club', type: 'group', body: 'Founded by [[Alex|our founder]].' }, { id: 'e5', title: 'Note', type: 'note', body: 'Ask [[Sam]].' }] }
  assert.deepEqual(wikilinkMentions(withNotes, 'serenity:entity/e1'), [
    { uri: 'serenity:page/research', title: 'Research', excerpt: 'Meet [[alex]] on Friday.' },
    { uri: 'serenity:entity/e4', title: 'Club', excerpt: 'Founded by [[Alex|our founder]].' }
  ])
  assert.deepEqual(wikilinkMentions(withNotes, 'serenity:entity/e2'), [], 'an ambiguous name is not a mention')
})

test('a page lists its resolved and unresolved links without treating code as links', () => {
  const full = { ...snapshot, claims: [], tasks: [], events: [], conversations: [], proposals: [] } as unknown as WorkspaceSnapshot
  const links = pageOutgoingLinks(full, 'See [[Alex]] and [the syllabus](serenity:document/syllabus.pdf), [[Sam]], [[Nobody]].\n`[[Research]]`\n```md\n[[Research]]\n```')
  assert.deepEqual(links.map(({ uri, title, detail }) => ({ uri, title, detail })), [
    { uri: 'serenity:entity/e1', title: 'Alex', detail: 'entity' },
    { uri: undefined, title: 'Sam', detail: 'Ambiguous: Sam (person) · Sam (dog)' },
    { uri: undefined, title: 'Nobody', detail: 'Missing link' },
    { uri: 'serenity:document/syllabus.pdf', title: 'syllabus.pdf', detail: 'document' }
  ])
})

test('typing [[ offers unambiguous titles and completing closes the link', async () => {
  const { completeWikilink, wikilinkQueryAt, wikilinkSuggestions } = await import('../src/shared/wikilinks')
  assert.deepEqual(wikilinkQueryAt('Met [[al', 8), { start: 6, query: 'al' })
  assert.equal(wikilinkQueryAt('Met [[Alex]] now', 16), null)
  assert.equal(wikilinkQueryAt('[[a\nb', 5), null, 'only the current line counts')
  assert.equal(wikilinkQueryAt('[[Alex|fr', 9), null, 'the label part is free text')
  assert.deepEqual(completeWikilink('Met [[al and', 8, 6, 'Alex'), { text: 'Met [[Alex]] and', caret: 12 })
  assert.deepEqual(completeWikilink('Met [[al]]', 8, 6, 'Alex'), { text: 'Met [[Alex]]', caret: 12 })
  assert.deepEqual(wikilinkSuggestions(snapshot, 's').map((item) => item.title), ['syllabus.pdf', 'Research'], 'prefix matches first; the ambiguous Sam is not offered')
})

test('renaming rewrites links to the old title, keeping labels and headings, outside code', async () => {
  const { renameWikilinks } = await import('../src/shared/wikilinks')
  const text = 'See [[alex]], [[Alex|him]], [[Alex#Work]], [[Alexander]].\n`[[Alex]]`\n```\n[[Alex]]\n```'
  assert.deepEqual(renameWikilinks(text, 'Alex', 'Alex Rivera'), {
    text: 'See [[Alex Rivera]], [[Alex Rivera|him]], [[Alex Rivera#Work]], [[Alexander]].\n`[[Alex]]`\n```\n[[Alex]]\n```', count: 3 })
})

test('the workspace rewrites links to a renamed title in chosen notes only, never frontmatter', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Workspace } = await import('../src/main/workspace')
  const directory = await mkdtemp(join(tmpdir(), 'serenity-rename-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const note = (await workspace.saveEntity({ id: '', title: 'Club', type: 'group', body: 'Founded by [[Alex]] and [[Alex|him]].' })).entities[0]
    const other = (await workspace.saveEntity({ id: '', title: 'Other', type: 'note', body: 'Also [[Alex]].' })).entities.find((item) => item.title === 'Other')!
    await writeFile(join(directory, 'pages', 'Plan.md'), '---\nid: plan\ntitle: "[[Alex]] plan"\nkind: page\n---\nCall [[Alex]].\n')
    workspace.markDirty()
    const { snapshot, count } = await workspace.renameWikilinks('Alex', 'Alex Rivera', ['serenity:entity/' + note.id, 'serenity:page/plan', 'serenity:page/missing'])
    assert.equal(count, 3)
    assert.equal(snapshot.entities.find((item) => item.id === note.id)?.body, 'Founded by [[Alex Rivera]] and [[Alex Rivera|him]].')
    assert.equal(snapshot.entities.find((item) => item.id === other.id)?.body, 'Also [[Alex]].', 'notes not chosen stay as written')
    assert.match(await readFile(join(directory, 'pages', 'Plan.md'), 'utf8'), /title: "\[\[Alex\]\] plan"[\s\S]*Call \[\[Alex Rivera\]\]\./)
    await assert.rejects(workspace.renameWikilinks('Alex', 'Bad]]name', []), /cannot be used in a wikilink/)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
