import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkspaceSnapshot } from '../src/shared/types'
import { calendarAgenda } from '../src/shared/calendar-agenda'

test('agenda orders a month of events and open due tasks without changing their records', () => {
  const snapshot = {
    modules: { calendar: true, tasks: true },
    events: [
      { id: 'late', title: 'Evening', start: '2026-09-14T18:00', notes: '' },
      { id: 'early', title: 'Morning', start: '2026-09-14T09:00', notes: 'Bring notes' },
      { id: 'other', title: 'Next month', start: '2026-10-01', notes: '' }
    ],
    tasks: [
      { id: 'task', title: 'Prepare', due: '2026-09-14', completed: false, notes: '' },
      { id: 'done', title: 'Done', due: '2026-09-14', completed: true, notes: '' }
    ]
  } as WorkspaceSnapshot
  assert.deepEqual(calendarAgenda(snapshot, '2026-09').map((item) => item.id), ['early', 'late', 'task'])
  assert.deepEqual(calendarAgenda({ ...snapshot, modules: { ...snapshot.modules, tasks: false } }, '2026-09').map((item) => item.id), ['early', 'late'])
  assert.deepEqual(calendarAgenda(snapshot, '2026-08'), [])
})
