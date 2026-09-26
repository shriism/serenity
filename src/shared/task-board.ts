import type { TaskItem } from './types'

export type TaskBucket = 'overdue' | 'soon' | 'later' | 'undated' | 'completed'

/** A due-date board uses the existing task fields; it does not invent a stored workflow status. */
export function taskBucket(task: TaskItem, today: string, soonThrough: string): TaskBucket {
  if (task.completed) return 'completed'
  if (!task.due) return 'undated'
  if (task.due < today) return 'overdue'
  return task.due <= soonThrough ? 'soon' : 'later'
}

export function taskBoard(tasks: readonly TaskItem[], today: string): Record<TaskBucket, TaskItem[]> {
  const end = new Date(`${today}T12:00:00`)
  end.setDate(end.getDate() + 7)
  const soonThrough = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  const board: Record<TaskBucket, TaskItem[]> = { overdue: [], soon: [], later: [], undated: [], completed: [] }
  for (const task of tasks) board[taskBucket(task, today, soonThrough)].push(task)
  for (const bucket of Object.values(board)) bucket.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title))
  return board
}
