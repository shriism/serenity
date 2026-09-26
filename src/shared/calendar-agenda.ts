import type { WorkspaceSnapshot } from './types'

export interface AgendaItem { kind: 'event' | 'task'; id: string; day: string; time?: string; title: string; detail: string }

/** A bounded month view over the existing internal calendar and task records. */
export function calendarAgenda(snapshot: WorkspaceSnapshot, month: string): AgendaItem[] {
  const items: AgendaItem[] = [
    ...(snapshot.modules.calendar ? snapshot.events.filter((event) => event.start.slice(0, 7) === month).map((event) => ({
      kind: 'event' as const, id: event.id, day: event.start.slice(0, 10), time: event.start.slice(11, 16) || undefined,
      title: event.title, detail: event.notes
    })) : []),
    ...(snapshot.modules.tasks ? snapshot.tasks.filter((task) => !task.completed && task.due?.slice(0, 7) === month).map((task) => ({
      kind: 'task' as const, id: task.id, day: task.due!, title: task.title, detail: task.notes
    })) : [])
  ]
  return items.sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '24:00').localeCompare(b.time ?? '24:00') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
