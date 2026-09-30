import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkspaceSnapshot } from '../src/shared/types'
import { calendarUpcoming, calendarUpcomingAll } from '../src/shared/calendar-agenda'

test('agenda orders upcoming events and open due tasks without changing their records', () => {
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
  assert.deepEqual(calendarUpcomingAll(snapshot, '2026-09-01').map((item) => item.id), ['early', 'late', 'task', 'other'])
  assert.deepEqual(calendarUpcomingAll({ ...snapshot, modules: { ...snapshot.modules, tasks: false } }, '2026-09-01').map((item) => item.id), ['early', 'late', 'other'])
  assert.deepEqual(calendarUpcomingAll(snapshot, '2026-11-01'), [])
})

test('upcoming includes the next month without showing past items or completed tasks', () => {
  const snapshot = {
    modules: { calendar: true, tasks: true },
    events: [
      { id: 'past', title: 'Past', start: '2026-09-27', notes: '' },
      { id: 'tomorrow', title: 'Tomorrow', start: '2026-09-29', notes: '' },
      { id: 'next-month', title: 'October event', start: '2026-10-02', notes: '' },
      { id: 'later', title: 'December event', start: '2026-12-02', notes: '' }
    ],
    tasks: [
      { id: 'due', title: 'October task', due: '2026-10-01', completed: false, notes: '' },
      { id: 'done', title: 'Done', due: '2026-09-30', completed: true, notes: '' }
    ]
  } as WorkspaceSnapshot
  assert.deepEqual(calendarUpcoming(snapshot, '2026-09-28').map((item) => item.id), ['tomorrow', 'due', 'next-month'])
  assert.deepEqual(calendarUpcomingAll(snapshot, '2026-09-28').map((item) => item.id), ['tomorrow', 'due', 'next-month', 'later'])
})
