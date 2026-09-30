import type { WorkspaceSnapshot } from './types'

export interface AgendaItem { kind: 'event' | 'task'; id: string; day: string; time?: string; title: string; detail: string }

/** Events and open due tasks, in date order, from the existing workspace records. */
function calendarItems(snapshot: WorkspaceSnapshot): AgendaItem[] {
  const items: AgendaItem[] = [
    ...(snapshot.modules.calendar ? snapshot.events.map((event) => ({
      kind: 'event' as const, id: event.id, day: event.start.slice(0, 10), time: event.start.slice(11, 16) || undefined,
      title: event.title, detail: event.notes
    })) : []),
    ...(snapshot.modules.tasks ? snapshot.tasks.filter((task) => !task.completed && task.due).map((task) => ({
      kind: 'task' as const, id: task.id, day: task.due!, title: task.title, detail: task.notes
    })) : [])
  ]
  return items.sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '24:00').localeCompare(b.time ?? '24:00') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

/** Every scheduled item from this local day onward, with no month or 30-day limit. */
export function calendarUpcomingAll(snapshot: WorkspaceSnapshot, from: string): AgendaItem[] {
  return calendarItems(snapshot).filter((item) => item.day >= from)
}

/** Upcoming records across month boundaries, starting on the supplied local calendar day. */
export function calendarUpcoming(snapshot: WorkspaceSnapshot, from: string, days = 30): AgendaItem[] {
  const end = new Date(`${from}T12:00:00`)
  end.setDate(end.getDate() + days)
  const through = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  return calendarUpcomingAll(snapshot, from).filter((item) => item.day < through)
}
