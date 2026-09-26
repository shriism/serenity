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
