import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ResourcePicker } from './resource-picker'
import type { CalendarEvent, TaskItem, WorkspaceSnapshot } from '../../shared/types'
import { taskBoard, type TaskBucket } from '../../shared/task-board'
import { calendarAgenda } from '../../shared/calendar-agenda'
import { resourceUri } from '../../shared/resources'

type Props = {
  workspace: WorkspaceSnapshot
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
  focusEventId?: string | null
  focusTaskId?: string | null
  focusVersion?: number
  taskPresentation?: 'list' | 'board'
  onTaskPresentationChange?(presentation: 'list' | 'board'): void
  calendarPresentation?: 'month' | 'agenda'
  onCalendarPresentationChange?(presentation: 'month' | 'agenda'): void
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

export function CalendarModule({ workspace, onUpdate, onError, focusEventId, focusVersion,
  calendarPresentation = 'month', onCalendarPresentationChange, onOpenResource }: Props) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [selectedDay, setSelectedDay] = useState(today())
  const [draft, setDraft] = useState<CalendarEvent>({ id: '', title: '', start: today(), notes: '', relatedEntityIds: [] })
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const event = workspace.events.find((item) => item.id === focusEventId)
    if (!event) return
    setMonth(event.start.slice(0, 7))
    setSelectedDay(event.start.slice(0, 10))
    setDraft(event)
    setTime(event.start.slice(11, 16))
    setEndTime(event.end?.slice(11, 16) ?? '')
  }, [focusEventId, focusVersion])
  const [year, number] = month.split('-').map(Number)
  const firstDay = new Date(year, number - 1, 1).getDay()
  const dayCount = new Date(year, number, 0).getDate()
  const cells = Math.ceil((firstDay + dayCount) / 7) * 7
  const days = Array.from({ length: cells }, (_, index) =>
    index < firstDay || index >= firstDay + dayCount ? null : `${month}-${String(index - firstDay + 1).padStart(2, '0')}`)
  const agenda = calendarAgenda(workspace, month)

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
    if (!draft.id || !draft.revision || !window.confirm(`Archive ${draft.title}? You can restore it later.`)) return
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
      <button type="button" aria-pressed={calendarPresentation === 'month'} className={calendarPresentation === 'month' ? 'active' : ''} onClick={() => onCalendarPresentationChange?.('month')}>Month</button>
      <button type="button" aria-pressed={calendarPresentation === 'agenda'} className={calendarPresentation === 'agenda' ? 'active' : ''} onClick={() => onCalendarPresentationChange?.('agenda')}>Agenda</button>
    </div></div></header>
    <div className="calendar-layout">
      <div>
        <div className="calendar-toolbar">
          <button className="icon-btn" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
          <h2>{new Date(year, number - 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button className="icon-btn" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
        </div>
        {calendarPresentation === 'agenda' ? <div className="calendar-agenda">
          {agenda.length === 0 && <p className="hint">No events or open tasks due this month.</p>}
          <ol>{agenda.map((item, index) => <li key={`${item.kind}:${item.id}`}>
            {(index === 0 || agenda[index - 1].day !== item.day) && <h3>{new Date(`${item.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>}
            <button type="button" onClick={(event) => {
              if (item.kind === 'task') onOpenResource?.(resourceUri({ kind: 'task', id: item.id }), event.metaKey || event.ctrlKey)
              else {
                const selected = workspace.events.find((entry) => entry.id === item.id)
                if (selected) { setSelectedDay(item.day); setDraft(selected); setTime(selected.start.slice(11, 16)); setEndTime(selected.end?.slice(11, 16) ?? '') }
              }
            }}><span><strong>{item.title}</strong><small>{item.kind === 'task' ? 'Task due' : item.time || 'All day'}</small></span>
              {item.detail && <small className="agenda-detail">{item.detail}</small>}</button>
          </li>)}</ol>
        </div> : <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="weekday" key={day}>{day}</span>)}
          {days.map((day, index) => day ? <button key={day} className={day === selectedDay ? 'selected' : ''}
            onClick={() => { setSelectedDay(day); if (!draft.id) clearDraft(day) }}>
            <strong>{Number(day.slice(-2))}</strong>
            {workspace.events.filter((item) => item.start.slice(0, 10) === day).map((item) => <small key={item.id}>{item.title}</small>)}
            {workspace.modules.tasks && workspace.tasks.filter((item) => item.due === day && !item.completed).map((item) => <small key={item.id}>☐ {item.title}</small>)}
          </button> : <span key={`empty-${index}`}/>)}
        </div>}
      </div>
      <aside className="module-aside">
        <h2>{new Date(`${selectedDay}T12:00`).toLocaleDateString(undefined, { dateStyle: 'full' })}</h2>
        {workspace.events.filter((item) => item.start.slice(0, 10) === selectedDay).map((item) => <button key={item.id}
          className="module-record" onClick={() => { setDraft(item); setTime(item.start.slice(11, 16)); setEndTime(item.end?.slice(11, 16) ?? '') }}>
          <strong>{item.title}</strong><small>{item.start.slice(11) || 'All day'} · {item.relatedEntityIds.map((id) => workspace.entities.find((entity) => entity.id === id)?.title).filter(Boolean).join(', ')}</small>
        </button>)}
        {workspace.events.every((item) => item.start.slice(0, 10) !== selectedDay) && <p className="hint">No events on this day.</p>}
        <form className="module-form" onSubmit={(event) => void save(event)}>
          <h3>{draft.id ? 'Edit event' : 'Add event'}</h3>
          <label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>Date<input type="date" required value={draft.start.slice(0, 10)} onChange={(event) => setDraft({ ...draft, start: event.target.value })}/></label>
          <label>Start time (optional)<input type="time" value={time} onChange={(event) => setTime(event.target.value)}/></label>
          <label>End time (optional)<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)}/></label>
          <EntityLinks workspace={workspace} selected={draft.relatedEntityIds} onChange={(relatedEntityIds) => setDraft({ ...draft, relatedEntityIds })}/>
          <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label>
          <button className="primary" type="submit" disabled={busy}>Save event</button>
          {draft.id && <><button className="secondary" type="button" onClick={() => void archive()}>Archive event</button>
            <button className="text-button" type="button" onClick={() => clearDraft(selectedDay)}>Cancel editing</button></>}
        </form>
        {workspace.archivedEvents.length > 0 && <details className="archived-items"><summary>Archived events ({workspace.archivedEvents.length})</summary>
          {workspace.archivedEvents.map((item) => <div key={item.id}><span>{item.title}</span><button onClick={() => void restore(item)}>Restore</button></div>)}
        </details>}
      </aside>
    </div>
  </section>
}

export function TasksModule({ workspace, onUpdate, onError, focusTaskId, focusVersion, taskPresentation = 'list', onTaskPresentationChange }: Props) {
  const [draft, setDraft] = useState<TaskItem>({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] })
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
    <div className={`tasks-layout ${presentation === 'board' ? 'board-layout' : ''}`}>
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
            <button title="Mark completed" onClick={() => void changeCompletion(item)}>☐</button>
            <div><strong>{item.title}</strong><small>{item.due ? `Due ${item.due} · ` : ''}{item.relatedEntityIds.map((id) => workspace.entities.find((entity) => entity.id === id)?.title).filter(Boolean).join(', ')}</small></div>
            <button className="text-button" onClick={() => edit(item)}>Edit</button>
            <button className="text-button" onClick={() => void archive(item)}>Archive</button>
          </div>)}
        <h2>Completed</h2>
        {workspace.tasks.filter((item) => item.completed).map((item) => <div key={item.id} className="task-row complete">
          <button title="Reopen task" onClick={() => void changeCompletion(item)}>☑</button><strong>{item.title}</strong>
          <button className="text-button" onClick={() => edit(item)}>Edit</button>
          <button className="text-button" onClick={() => void archive(item)}>Archive</button>
        </div>)}
        </>}
        {workspace.archivedTasks.length > 0 && <details className="archived-items"><summary>Archived tasks ({workspace.archivedTasks.length})</summary>
          {workspace.archivedTasks.map((item) => <div key={item.id}><span>{item.title}</span><button onClick={() => void window.serenity.restoreTask(item.id).then(onUpdate).catch((cause) => onError(String(cause)))}>Restore</button></div>)}
        </details>}
      </div>
      <aside className="module-aside">
        <form className="module-form" onSubmit={(event) => void save(event)}>
          <h3>{draft.id ? 'Edit task' : 'Add task'}</h3>
          <label>Title<input ref={titleInput} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>Due date<input type="date" value={draft.due ?? ''} onChange={(event) => setDraft({ ...draft, due: event.target.value || undefined })}/></label>
          <EntityLinks workspace={workspace} selected={draft.relatedEntityIds} onChange={(relatedEntityIds) => setDraft({ ...draft, relatedEntityIds })}/>
          <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label>
          <button className="primary" type="submit" disabled={busy}>Save task</button>
          {draft.id && <button className="text-button" type="button" onClick={clearDraft}>Cancel editing</button>}
        </form>
      </aside>
    </div>
  </section>
}
