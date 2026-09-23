import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDuplicateProposal } from '../src/shared/deduplicate'
import type { Claim, Proposal, WorkspaceSnapshot } from '../src/shared/types'

const base = { id: '1', provider: 'copilot' as const, conversationId: '2', recordedAt: '2026-09-23T00:00:00Z',
  source: 'Alex said', origin: 'ai-statement' as const, status: 'pending' as const }

test('repeat extraction does not propose known facts but preserves corrections and new evidence', () => {
  const birthday: Claim = { id: 'c1', subject: 'alex', key: 'birthday', value: 'September 7', source: 'Alex',
    origin: 'human', status: 'confirmed', recordedAt: '2026-09-23T00:00:00Z' }
  const knowledge: Pick<WorkspaceSnapshot, 'claims' | 'proposals' | 'tasks' | 'events'> = {
    claims: [birthday], proposals: [], tasks: [], events: []
  }
  const repeat: Proposal = { ...base, kind: 'claim', subject: 'alex', key: ' Birthday ', value: 'september  7' }
  assert.equal(isDuplicateProposal(repeat, knowledge), true)
  assert.equal(isDuplicateProposal({ ...repeat, value: 'September 8' }, knowledge), false)
  knowledge.proposals.push({ ...repeat, value: 'September 8', status: 'rejected' })
  assert.equal(isDuplicateProposal({ ...repeat, value: 'September 8' }, knowledge), true)
  assert.equal(isDuplicateProposal({ ...repeat, value: 'September 8', source: 'New document' }, knowledge), false)
  knowledge.tasks.push({ id: 'task1', title: 'Submit assignment', due: '2026-10-03', completed: false, notes: '', relatedEntityIds: [] })
  assert.equal(isDuplicateProposal({ ...base, kind: 'task', title: 'submit assignment', due: '2026-10-03', notes: '', relatedEntityIds: [] }, knowledge), true)
})
