import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityCandidates } from '../src/shared/identity'

test('identity resolution offers close matches without asserting same identity', () => {
  const candidates = identityCandidates('Alex Chen', 'person', [
    { id: '1', title: 'Alex Chen', type: 'person', body: '' },
    { id: '2', title: 'Alex from club', type: 'person', body: '' },
    { id: '3', title: 'Robotics', type: 'concept', body: '' }
  ])
  assert.deepEqual(candidates.map(({ entity }) => entity.id), ['1', '2'])
  assert.equal(candidates[0].score, 1)
  assert.deepEqual(identityCandidates('', 'person', []), [])
})
