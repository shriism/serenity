import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentOutline } from '../src/shared/document-outline'

test('a Markdown document outline uses explicit headings and skips metadata and code', () => {
  const text = '---\ntitle: Note\n---\n# First\nText\n```md\n# Example only\n```\n## Second\n'
  const headings = documentOutline('note.md', text)
  assert.deepEqual(headings.map(({ title, level }) => [title, level]), [['First', 1], ['Second', 2]])
  assert.equal(text.slice(headings[1].start, headings[1].end), '## Second')
  assert.deepEqual(documentOutline('note.pdf', text), [])
  assert.deepEqual(documentOutline('note.md', '---\r\ntitle: Note\r\n---\r\n# Content\r\n').map((heading) => heading.title), ['Content'])
})
