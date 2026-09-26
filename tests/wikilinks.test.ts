import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkWikilinks, resolveWikilink } from '../src/shared/wikilinks'

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
