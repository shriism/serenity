import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopeFromResults } from '../src/shared/result-scope'

test('search results become a selected read scope of the entities and documents they point to', () => {
  const result = (kind: 'entity' | 'claim' | 'document' | 'page' | 'task', id: string) => ({ kind, id, title: id, detail: '' })
  const scope = scopeFromResults([result('entity', 'alex'), result('claim', 'alex'), result('claim', 'sam'), result('document', 'syllabus.pdf'),
    result('page', 'home'), result('task', 't1'), result('entity', 'deleted'), result('document', 'gone.pdf')],
  { entities: [{ id: 'alex', title: 'Alex', type: 'person', body: '' }, { id: 'sam', title: 'Sam', type: 'person', body: '' }], documents: [{ name: 'syllabus.pdf', size: 1, extractable: true }] })
  assert.deepEqual(scope, { entityIds: ['alex', 'sam'], documentNames: ['syllabus.pdf'] })
})
