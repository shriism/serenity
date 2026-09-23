import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAutoApply, defaultWorkflowPermissions, validateWorkflowPermissions } from '../src/shared/workflow'
import type { Proposal } from '../src/shared/types'

const common = { id: '1', provider: 'copilot' as const, conversationId: '2', status: 'pending' as const, recordedAt: '2026-09-23T00:00:00Z', source: 'User', origin: 'ai-statement' as const }

test('autonomous workflows start with claim-only writes and guard new categories', () => {
  const permissions = validateWorkflowPermissions(undefined)
  assert.deepEqual(permissions, defaultWorkflowPermissions)
  const claim: Proposal = { ...common, kind: 'claim', subject: '3', key: 'birthday', value: 'September 7' }
  const task: Proposal = { ...common, kind: 'task', title: 'Call Alex', notes: '', relatedEntityIds: [] }
  const entity: Proposal = { ...common, kind: 'entity', title: 'Alex', type: 'person', body: '' }
  const context = { knownCategories: ['person'], identityCandidates: 0 }
  assert.equal(canAutoApply('propose', permissions, claim, context), false)
  assert.equal(canAutoApply('autonomous', permissions, claim, context), true)
  assert.equal(canAutoApply('autonomous', permissions, claim, { ...context, ambiguousIdentity: true }), false)
  assert.equal(canAutoApply('autonomous', permissions, task, context), false)
  assert.equal(canAutoApply('autonomous', { ...permissions, tasks: true }, task, context), true)
  assert.equal(canAutoApply('autonomous', { ...permissions, entities: true }, entity, { knownCategories: [], identityCandidates: 0 }), false)
  assert.equal(canAutoApply('autonomous', { ...permissions, entities: true }, entity, { knownCategories: ['person'], identityCandidates: 1 }), false)
  assert.equal(canAutoApply('autonomous', { ...permissions, entities: true }, entity, context), true)
  assert.throws(() => validateWorkflowPermissions({ claims: true }), /permission/)
})
