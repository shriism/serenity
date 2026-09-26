import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerSegments, citationUri, validateCitations } from '../src/shared/citations'

const records = new Map([
  ['claim:c1', { title: 'birthday: September 7', text: JSON.stringify({ key: 'birthday', value: 'September 7', source: 'Alex told me\nin person' }) }],
  ['document:syllabus.pdf', { title: 'syllabus.pdf', text: 'Midterm exam on October 12.' }],
  ['entity:unsent', { title: 'Sam', text: '{}' }]
])

test('citations record whether each was actually sent and whether its quote is real', () => {
  const citations = validateCitations([
    { ref: 'claim:c1', quote: 'Alex told me in person' },
    { ref: 'document:syllabus.pdf', quote: 'Final exam on December 1' },
    'entity:unsent',
    { ref: 'entity:invented-by-model' },
    { ref: 'claim:c1' },
    { ref: 'not a ref' },
    42
  ], new Set(['claim:c1', 'document:syllabus.pdf']), records)
  assert.deepEqual(citations, [
    { ref: 'claim:c1', title: 'birthday: September 7', sent: true, quote: 'Alex told me in person', quoteFound: true },
    { ref: 'document:syllabus.pdf', title: 'syllabus.pdf', sent: true, quote: 'Final exam on December 1', quoteFound: false },
    { ref: 'entity:unsent', title: 'Sam', sent: false },
    { ref: 'entity:invented-by-model', title: 'entity:invented-by-model', sent: false }
  ])
  assert.deepEqual(validateCitations('claim:c1', new Set(), records), [])
  assert.equal(validateCitations(Array.from({ length: 50 }, (_, index) => `claim:${index}`), new Set(), records).length, 20)
})

test('only markers for existing citations are split out, and only openable refs link', () => {
  assert.deepEqual(answerSegments('Born September 7 [1], exam soon [2][3]. See [9] and [x].', 2), [
    { text: 'Born September 7 ' }, { citation: 1 }, { text: ', exam soon ' }, { citation: 2 }, { text: '[3]. See [9] and [x].' }
  ])
  assert.equal(citationUri('document:syllabus.pdf'), 'serenity:document/syllabus.pdf')
  assert.equal(citationUri('claim:c1'), 'serenity:claim/c1')
  assert.equal(citationUri('merge:abc'), null)
  assert.equal(citationUri('document:../escape'), null)
})
