import { memo, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { CalendarOptions, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { ResourcePicker } from './resource-picker'
import type { CalendarEvent, TaskItem, WorkspaceSnapshot } from '../../shared/types'
import { taskBoard, type TaskBucket } from '../../shared/task-board'
import { calendarAgenda } from '../../shared/calendar-agenda'
import { resourceUri } from '../../shared/resources'
import { Dialog } from './dialog'

type Props = {
  workspace: WorkspaceSnapshot
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
  focusEventId?: string | null
  focusTaskId?: string | null
  focusVersion?: number
  taskPresentation?: 'list' | 'board'
  onTaskPresentationChange?(presentation: 'list' | 'board'): void
  calendarPresentation?: 'month' | 'week' | 'day' | 'agenda'
  onCalendarPresentationChange?(presentation: 'month' | 'week' | 'day' | 'agenda'): void
  onOpenResource?(uri: string, side: boolean): void
}

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function EntityLinks({ workspace, selected, onChange }: {
  workspace: WorkspaceSnapshot
  selected: string[]
  onChange(ids: string[]): void
}) {
  const options = useMemo(() => workspace.entities.map((entity) => ({ id: entity.id, title: entity.title, detail: entity.type })), [workspace.entities])
  return <fieldset className="module-links">
    <legend>Connected knowledge</legend>
    <ResourcePicker label="Link an entity" placeholder="Link a person, project, or other entity…" options={options} selected={selected} onChange={onChange}
      empty="Create an entity to link it here."/>
  </fieldset>
}

// FullCalendar keeps the starting context by identity throughout a pointer gesture.
// Replacing its options on a watcher refresh can silently discard the drop. Hold the
// rendered options until the gesture ends; the parent then renders the latest snapshot.
const InteractiveCalendar = memo(function InteractiveCalendar({ calendarRef, interacting: _interacting, ...options }:
  CalendarOptions & { calendarRef: RefObject<FullCalendar | null>; interacting: RefObject<boolean> }) {
  return <FullCalendar ref={calendarRef} {...options}/>
}, (_previous, next) => next.interacting.current)

export function CalendarModule({ workspace, onUpdate, onError, focusEventId, focusVersion,
  calendarPresentation = 'month', onCalendarPresentationChange, onOpenResource }: Props) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [selectedDay, setSelectedDay] = useState(today())
  const [draft, setDraft] = useState<CalendarEvent>({ id: '', title: '', start: today(), notes: '', relatedEntityIds: [] })
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [busy, setBusy] = useState(false)
  const calendar = useRef<FullCalendar>(null)
  const interacting = useRef(false)
  const [, redrawCalendar] = useReducer((version: number) => version + 1, 0)
  const beginInteraction = (): void => { interacting.current = true }
  const endInteraction = (): void => {
    // eventDragStop/eventResizeStop fire before the drop/resize commit callback.
    // Let that callback finish with the original revision before updating options.
    queueMicrotask(() => { interacting.current = false; redrawCalendar() })
  }
  const [editorOpen, setEditorOpen] = useState(false)
  useEffect(() => {
    const event = workspace.events.find((item) => item.id === focusEventId)
    if (!event) return
    setMonth(event.start.slice(0, 7))
    setSelectedDay(event.start.slice(0, 10))
    setDraft(event)
    setTime(event.start.slice(11, 16))
    setEndTime(event.end?.slice(11, 16) ?? '')
    setEditorOpen(true)
    calendar.current?.getApi().gotoDate(event.start.slice(0, 10))
  }, [focusEventId, focusVersion])
  const [year, number] = month.split('-').map(Number)
  const agenda = calendarAgenda(workspace, month)
  const calendarEvents = useMemo<EventInput[]>(() => [
    ...workspace.events.map((event) => ({ id: `event:${event.id}`, title: event.title, start: event.start, end: event.end,
      allDay: !event.start.includes('T'), classNames: ['serenity-calendar-event'] })),
    ...(workspace.modules.tasks ? workspace.tasks.filter((task) => task.due && !task.completed).map((task) => ({
      id: `task:${task.id}`, title: `☐ ${task.title}`, start: task.due, allDay: true, editable: false,
      classNames: ['serenity-calendar-task'] })) : [])
  ], [workspace.events, workspace.tasks, workspace.modules.tasks])

  useEffect(() => {
    if (calendarPresentation !== 'agenda') calendar.current?.getApi().changeView({ month: 'dayGridMonth', week: 'timeGridWeek', day: 'timeGridDay' }[calendarPresentation])
  }, [calendarPresentation])

  async function moveEvent(info: EventDropArg | EventResizeDoneArg): Promise<void> {
    const original = workspace.events.find((item) => `event:${item.id}` === info.event.id)
    if (!original) { info.revert(); return }
    try {
      const start = info.event.startStr.slice(0, original.start.includes('T') || !info.event.allDay ? 16 : 10)
      const end = original.end ? info.event.endStr.slice(0, original.end.includes('T') || !info.event.allDay ? 16 : 10) : undefined
      onUpdate(await window.serenity.saveEvent({ ...original, start, end }))
      setSelectedDay(start.slice(0, 10))
    } catch (cause) { info.revert(); onError(String(cause)) }
  }

  function changeMonth(offset: number): void {
    const next = new Date(year, number - 1 + offset, 1)
    const value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
    setMonth(value)
    setSelectedDay(`${value}-01`)
  }

  function clearDraft(day: string): void {
    setDraft({ id: '', title: '', start: day, notes: '', relatedEntityIds: [] })
    setTime('')
    setEndTime('')
    setEditorOpen(false)
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    try {
      const day = draft.start.slice(0, 10)
      const snapshot = await window.serenity.saveEvent({ ...draft,
        start: `${day}${time ? `T${time}` : ''}`, end: endTime ? `${day}T${endTime}` : undefined })
      onUpdate(snapshot)
      setSelectedDay(day)
      clearDraft(day)
    } catch (cause) { onError(String(cause)) }
    finally { setBusy(false) }
  }

  async function archive(): Promise<void> {
    if (!draft.id || !draft.revision || !window.confirm(`Move “${draft.title}” to Trash? You can restore it later.`)) return
    try { onUpdate(await window.serenity.archiveEvent(draft.id, draft.revision)); clearDraft(selectedDay) }
    catch (cause) { onError(String(cause)) }
  }

  async function restore(event: CalendarEvent): Promise<void> {
    try {
      onUpdate(await window.serenity.restoreEvent(event.id))
      setSelectedDay(event.start.slice(0, 10))
      setMonth(event.start.slice(0, 7))
    } catch (cause) { onError(String(cause)) }
  }

  return <section className="page wide module-page">
    <header className="view-header"><div><h1>Calendar</h1></div><div className="view-actions">
    <div className="segmented task-view-toggle" role="group" aria-label="Calendar view">
      {(['day', 'week', 'month', 'agenda'] as const).map((view) => <button key={view} type="button" aria-pressed={calendarPresentation === view}
        className={calendarPresentation === view ? 'active' : ''} onClick={() => onCalendarPresentationChange?.(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}
    </div>
    <button type="button" className="icon-btn calendar-add" aria-label="Add event" title="Add event" onClick={() => {
      clearDraft(selectedDay); setEditorOpen(true)
    }}><Plus size={18}/></button></div></header>
    <div className="calendar-layout">
      <div>
        {calendarPresentation === 'agenda' && <div className="calendar-toolbar">
          <button className="icon-btn" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
          <h2>{new Date(year, number - 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button className="icon-btn" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
        </div>}
        {calendarPresentation === 'agenda' ? <div className="calendar-agenda">
          {agenda.length === 0 && <p className="hint">No events or open tasks due this month.</p>}
          <ol>{agenda.map((item, index) => <li key={`${item.kind}:${item.id}`}>
            {(index === 0 || agenda[index - 1].day !== item.day) && <h3>{new Date(`${item.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>}
            <button type="button" onClick={(event) => {
              if (item.kind === 'task') onOpenResource?.(resourceUri({ kind: 'task', id: item.id }), event.metaKey || event.ctrlKey)
              else {
                const selected = workspace.events.find((entry) => entry.id === item.id)
                if (selected) { setSelectedDay(item.day); setDraft(selected); setTime(selected.start.slice(11, 16)); setEndTime(selected.end?.slice(11, 16) ?? ''); setEditorOpen(true) }
              }
            }}><span><strong>{item.title}</strong><small>{item.kind === 'task' ? 'Task due' : item.time || 'All day'}</small></span>
              {item.detail && <small className="agenda-detail">{item.detail}</small>}</button>
          </li>)}</ol>
        </div> : <div className="calendar-surface">
          <InteractiveCalendar calendarRef={calendar} interacting={interacting} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={{ month: 'dayGridMonth', week: 'timeGridWeek', day: 'timeGridDay' }[calendarPresentation]}
            initialDate={selectedDay} headerToolbar={{ left: 'title', center: '', right: 'today prev,next' }}
            buttonIcons={false} buttonText={{ prev: '‹', next: '›', today: 'Today' }}
            height="auto" dayMaxEvents={3} nowIndicator editable events={calendarEvents}
            dayCellClassNames={(info) => `${info.date.getFullYear()}-${String(info.date.getMonth() + 1).padStart(2, '0')}-${String(info.date.getDate()).padStart(2, '0')}` === selectedDay ? ['selected-day'] : []}
            datesSet={(info) => setMonth(`${info.view.currentStart.getFullYear()}-${String(info.view.currentStart.getMonth() + 1).padStart(2, '0')}`)}
            dateClick={(info) => { const day = info.dateStr.slice(0, 10); setSelectedDay(day); clearDraft(day); if (!info.allDay) setTime(info.dateStr.slice(11, 16)) }}
            eventClick={(info) => {
              if (info.event.id.startsWith('task:')) { onOpenResource?.(resourceUri({ kind: 'task', id: info.event.id.slice(5) }), info.jsEvent.metaKey || info.jsEvent.ctrlKey); return }
              const selected = workspace.events.find((item) => `event:${item.id}` === info.event.id)
              if (selected) { setSelectedDay(selected.start.slice(0, 10)); setDraft(selected); setTime(selected.start.slice(11, 16)); setEndTime(selected.end?.slice(11, 16) ?? ''); setEditorOpen(true) }
            }}
            eventDragStart={beginInteraction} eventDragStop={endInteraction}
            eventResizeStart={beginInteraction} eventResizeStop={endInteraction}
            eventDrop={(info) => void moveEvent(info)} eventResize={(info) => void moveEvent(info)}/>
        </div>}
      </div>
    </div>
    {workspace.archivedEvents.length > 0 && <details className="archived-items calendar-archive"><summary>Trash ({workspace.archivedEvents.length})</summary>
      {workspace.archivedEvents.map((item) => <div key={item.id}><span>{item.title}</span><button onClick={() => void restore(item)}>Restore</button></div>)}
    </details>}
    {editorOpen && <Dialog title={draft.id ? 'Edit event' : 'New event'} className="calendar-event-dialog" onClose={() => clearDraft(selectedDay)}>
      <form className="module-form" onSubmit={(event) => void save(event)}>
        <label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
        <label>Date<input type="date" required value={draft.start.slice(0, 10)} onChange={(event) => setDraft({ ...draft, start: event.target.value })}/></label>
        <div className="event-times">
          <label>Start time (optional)<input type="time" value={time} onChange={(event) => setTime(event.target.value)}/></label>
          <label>End time (optional)<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)}/></label>
        </div>
        <EntityLinks workspace={workspace} selected={draft.relatedEntityIds} onChange={(relatedEntityIds) => setDraft({ ...draft, relatedEntityIds })}/>
        <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label>
        <div className="form-buttons">
          {draft.id && <button className="secondary" type="button" onClick={() => void archive()}>Move to Trash</button>}
          <button className="secondary" type="button" onClick={() => clearDraft(selectedDay)}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>Save</button>
        </div>
      </form>
    </Dialog>}
  </section>
}

export function TasksModule({ workspace, onUpdate, onError, focusTaskId, focusVersion, taskPresentation = 'list', onTaskPresentationChange }: Props) {
  const [draft, setDraft] = useState<TaskItem>({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] })
  const [quick, setQuick] = useState({ title: '', due: '' })
  const [busy, setBusy] = useState(false)
  const presentation = taskPresentation
  const titleInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const task = workspace.tasks.find((item) => item.id === focusTaskId)
    if (task) setDraft(task)
  }, [focusTaskId, focusVersion])
  const clearDraft = (): void => setDraft({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] })
  const edit = (task: TaskItem): void => {
    setDraft(task)
    requestAnimationFrame(() => titleInput.current?.focus())
  }
  const board = taskBoard(workspace.tasks, today())
  const boardColumns: { id: TaskBucket; title: string; empty: string }[] = [
    { id: 'overdue', title: 'Overdue', empty: 'Nothing overdue.' },
    { id: 'soon', title: 'Next 7 days', empty: 'Nothing due soon.' },
    { id: 'later', title: 'Later', empty: 'Nothing due later.' },
    { id: 'undated', title: 'No date', empty: 'No undated tasks.' },
    { id: 'completed', title: 'Completed', empty: 'No completed tasks.' }
  ]

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    try { onUpdate(await window.serenity.saveTask(draft)); clearDraft() }
    catch (cause) { onError(String(cause)) }
    finally { setBusy(false) }
  }

  /** Adds a task from the one-line field above the list; details can be added by editing it. */
  async function quickAdd(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!quick.title.trim()) return
    setBusy(true)
    try { onUpdate(await window.serenity.saveTask({ id: '', title: quick.title.trim(), due: quick.due || undefined, completed: false, notes: '', relatedEntityIds: [] })); setQuick({ title: '', due: '' }) }
    catch (cause) { onError(String(cause)) }
    finally { setBusy(false) }
  }

  async function archive(task: TaskItem): Promise<void> {
    if (!task.revision || !window.confirm(`Archive ${task.title}? You can restore it later.`)) return
    try { onUpdate(await window.serenity.archiveTask(task.id, task.revision)); if (draft.id === task.id) clearDraft() }
    catch (cause) { onError(String(cause)) }
  }

  async function changeCompletion(task: TaskItem): Promise<void> {
    try { onUpdate(await window.serenity.saveTask({ ...task, completed: !task.completed })) }
    catch (cause) { onError(String(cause)) }
  }

  return <section className="page wide module-page">
    <header className="view-header"><div><h1>Tasks</h1><p className="view-subtitle">{workspace.tasks.filter((item) => !item.completed).length} open</p></div><div className="view-actions">
    <div className="segmented task-view-toggle" role="group" aria-label="Task view">
      <button type="button" aria-pressed={presentation === 'list'} className={presentation === 'list' ? 'active' : ''} onClick={() => onTaskPresentationChange?.('list')}>List</button>
      <button type="button" aria-pressed={presentation === 'board'} className={presentation === 'board' ? 'active' : ''} onClick={() => onTaskPresentationChange?.('board')}>Board</button>
    </div></div></header>
    <form className="module-form task-quick-add" onSubmit={(event) => void quickAdd(event)}>
      <input aria-label="New task" placeholder="Add a task…" value={quick.title} onChange={(event) => setQuick({ ...quick, title: event.target.value })}/>
      <input type="date" aria-label="Due date" value={quick.due} onChange={(event) => setQuick({ ...quick, due: event.target.value })}/>
      <button className="primary" type="submit" disabled={busy || !quick.title.trim()}>Add</button>
    </form>
    <div className={`tasks-layout ${draft.id ? '' : 'full'} ${presentation === 'board' ? 'board-layout' : ''}`}>
      <div>
        {presentation === 'board' ? <div className="task-board">
          {boardColumns.map((column) => <section key={column.id} className="task-board-column" aria-label={`${column.title}, ${board[column.id].length} tasks`}>
            <h2>{column.title} <span>{board[column.id].length}</span></h2>
            {board[column.id].length === 0 && <p className="hint">{column.empty}</p>}
            {board[column.id].map((item) => <article key={item.id} className={`task-board-card ${item.completed ? 'complete' : ''}`}>
              <strong>{item.title}</strong>
              {item.due && <small>Due {item.due}</small>}
              {item.relatedEntityIds.length > 0 && <small>{item.relatedEntityIds.map((id) => workspace.entities.find((entity) => entity.id === id)?.title).filter(Boolean).join(', ')}</small>}
              <div className="task-board-actions">
                <button type="button" onClick={() => void changeCompletion(item)}>{item.completed ? 'Reopen' : 'Complete'}</button>
                <button type="button" onClick={() => edit(item)}>Edit</button>
                <button type="button" onClick={() => void archive(item)}>Archive</button>
              </div>
            </article>)}
          </section>)}
        </div> : <>
        <h2>To do</h2>
        {workspace.tasks.filter((item) => !item.completed).length === 0 && <p className="hint">No open tasks.</p>}
        {workspace.tasks.filter((item) => !item.completed).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')).map((item) =>
          <div key={item.id} className="task-row">
            <input type="checkbox" checked={false} aria-label={`Complete ${item.title}`} onChange={() => void changeCompletion(item)}/>
            <div><strong>{item.title}</strong><small>{item.due ? `Due ${item.due} · ` : ''}{item.relatedEntityIds.map((id) => workspace.entities.find((entity) => entity.id === id)?.title).filter(Boolean).join(', ')}</small></div>
            <button className="text-button" onClick={() => edit(item)}>Edit</button>
            <button className="text-button" onClick={() => void archive(item)}>Archive</button>
          </div>)}
        {workspace.tasks.some((item) => item.completed) && <h2>Completed</h2>}
        {workspace.tasks.filter((item) => item.completed).map((item) => <div key={item.id} className="task-row complete">
          <input type="checkbox" checked aria-label={`Reopen ${item.title}`} onChange={() => void changeCompletion(item)}/><strong>{item.title}</strong>
          <button className="text-button" onClick={() => edit(item)}>Edit</button>
          <button className="text-button" onClick={() => void archive(item)}>Archive</button>
        </div>)}
        </>}
        {workspace.archivedTasks.length > 0 && <details className="archived-items"><summary>Archived tasks ({workspace.archivedTasks.length})</summary>
          {workspace.archivedTasks.map((item) => <div key={item.id}><span>{item.title}</span><button onClick={() => void window.serenity.restoreTask(item.id).then(onUpdate).catch((cause) => onError(String(cause)))}>Restore</button></div>)}
        </details>}
      </div>
      {draft.id && <aside className="module-aside">
        <form className="module-form" onSubmit={(event) => void save(event)}>
          <h3>Edit task</h3>
          <label>Title<input ref={titleInput} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>Due date<input type="date" value={draft.due ?? ''} onChange={(event) => setDraft({ ...draft, due: event.target.value || undefined })}/></label>
          <EntityLinks workspace={workspace} selected={draft.relatedEntityIds} onChange={(relatedEntityIds) => setDraft({ ...draft, relatedEntityIds })}/>
          <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label>
          <div className="form-buttons"><button className="secondary" type="button" onClick={clearDraft}>Cancel</button><button className="primary" type="submit" disabled={busy}>Save</button></div>
        </form>
      </aside>}
    </div>
  </section>
}
