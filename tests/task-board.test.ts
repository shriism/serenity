import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taskBoard } from '../src/shared/task-board'
import type { TaskItem } from '../src/shared/types'

const task = (title: string, due?: string, completed = false): TaskItem => ({ id: title, title, due, completed, notes: '', relatedEntityIds: [] })

test('task board groups due dates without changing task status', () => {
  const board = taskBoard([
    task('later', '2026-10-04'), task('today', '2026-09-26'), task('week', '2026-10-03'),
    task('old', '2026-09-25'), task('undated'), task('done', '2026-09-01', true)
  ], '2026-09-26')
  assert.deepEqual(Object.fromEntries(Object.entries(board).map(([bucket, tasks]) => [bucket, tasks.map((item) => item.title)])), {
    overdue: ['old'], soon: ['today', 'week'], later: ['later'], undated: ['undated'], completed: ['done']
  })
  assert.equal(board.soon[0].completed, false)
})
