import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entityTypes, filterEntities } from '../src/shared/library'

const entity = (title: string, type: string) => ({ id: title, title, type, body: '' })
const entities = [entity('Sam', 'Person'), entity('Alex', 'person'), entity('Rovers', 'project'), entity('Salsa', 'hobby'), entity('Notes', '')]

test('the library filters by words and type, prefix matches first', () => {
  assert.deepEqual(entityTypes(entities), [{ type: 'Person', count: 2 }, { type: 'hobby', count: 1 }, { type: 'project', count: 1 }, { type: 'untyped', count: 1 }])
  assert.deepEqual(filterEntities(entities, 's', null).map((item) => item.title), ['Salsa', 'Sam', 'Alex', 'Notes', 'Rovers'], 'titles starting with the query come first')
  assert.deepEqual(filterEntities(entities, '', 'person').map((item) => item.title), ['Alex', 'Sam'])
  assert.deepEqual(filterEntities(entities, 'proj', null).map((item) => item.title), ['Rovers'], 'types match too')
  assert.deepEqual(filterEntities(entities, '', 'untyped').map((item) => item.title), ['Notes'])
})
