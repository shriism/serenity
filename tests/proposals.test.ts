import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proposalsBySource } from '../src/shared/proposals'
import type { Proposal } from '../src/shared/types'

const proposal = (id: string, source: string, status: Proposal['status'], recordedAt: string): Proposal =>
  ({ id, source, status, recordedAt, kind: 'task', title: id, notes: '', relatedEntityIds: [], provider: 'codex', conversationId: 'c', origin: 'ai-statement' })

test('proposals group by source with pending work first', () => {
  const groups = proposalsBySource([
    proposal('old-decided', 'notes.md', 'accepted', '2026-01-01'),
    proposal('syllabus-a', 'syllabus.pdf', 'accepted', '2026-02-01'),
    proposal('syllabus-b', 'syllabus.pdf', 'pending', '2026-01-15'),
    proposal('chat', 'Conversation', 'rejected', '2026-03-01')
  ])
  assert.deepEqual(groups.map((group) => [group.source, group.pending]), [['syllabus.pdf', 1], ['Conversation', 0], ['notes.md', 0]])
  assert.deepEqual(groups[0].proposals.map((item) => item.id), ['syllabus-b', 'syllabus-a'], 'pending first within a source')
})
