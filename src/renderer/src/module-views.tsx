import { useState, type FormEvent } from 'react'
import type { CalendarEvent, TaskItem, WorkspaceSnapshot } from '../../shared/types'

type Props = {
  workspace: WorkspaceSnapshot
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
}

function today(): string { return new Date().toLocaleDateString('en-CA') }

function EntityLinks({ workspace, selected, onChange }: {
  workspace: WorkspaceSnapshot
  selected: string[]
  onChange(ids: string[]): void
}) {
  return <fieldset className="module-links">
    <legend>Connected knowledge</legend>
    {workspace.entities.map((entity) => <label key={entity.id}>
      <input type="checkbox" checked={selected.includes(entity.id)} onChange={(event) =>
        onChange(event.target.checked ? [...selected, entity.id] : selected.filter((id) => id !== entity.id))}/>
      {entity.title}
    </label>)}
    {workspace.entities.length === 0 && <small className="hint">Create an entity to link it here.</small>}
  </fieldset>
}

export function CalendarModule({ workspace, onUpdate, onError }: Props) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [selectedDay, setSelectedDay] = useState(today())
  const [draft, setDraft] = useState<CalendarEvent>({ id: '', title: '', start: today(), notes: '', relatedEntityIds: [] })
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [year, number] = month.split('-').map(Number)
  const firstDay = new Date(year, number - 1, 1).getDay()
  const dayCount = new Date(year, number, 0).getDate()
  const days = Array.from({ length: firstDay + dayCount }, (_, index) =>
    index < firstDay ? null : `${month}-${String(index - firstDay + 1).padStart(2, '0')}`)

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

  return <section className="page module-page">
    <span className="eyebrow">SERENITY CALENDAR</span><h1>Calendar</h1>
    <p>Events live in this workspace and can connect to anything in your knowledge.</p>
    <div className="calendar-layout">
      <div>
        <div className="calendar-toolbar">
          <button aria-label="Previous month" onClick={() => changeMonth(-1)}>←</button>
          <h2>{new Date(year, number - 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button aria-label="Next month" onClick={() => changeMonth(1)}>→</button>
        </div>
        <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="weekday" key={day}>{day}</span>)}
          {days.map((day, index) => day ? <button key={day} className={day === selectedDay ? 'selected' : ''}
            onClick={() => { setSelectedDay(day); if (!draft.id) clearDraft(day) }}>
            <strong>{Number(day.slice(-2))}</strong>
            {workspace.events.filter((item) => item.start.slice(0, 10) === day).map((item) => <small key={item.id}>{item.title}</small>)}
            {workspace.modules.tasks && workspace.tasks.filter((item) => item.due === day && !item.completed).map((item) => <small key={item.id}>☐ {item.title}</small>)}
          </button> : <span key={`empty-${index}`}/>)}
        </div>
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

export function TasksModule({ workspace, onUpdate, onError }: Props) {
  const [draft, setDraft] = useState<TaskItem>({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] })
  const [busy, setBusy] = useState(false)
  const clearDraft = (): void => setDraft({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] })

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

  return <section className="page module-page">
    <span className="eyebrow">SERENITY TASKS</span><h1>Tasks</h1>
    <p>Plan what matters and connect it to your people, projects, or any other entities.</p>
    <div className="tasks-layout">
      <div>
        <h2>To do</h2>
        {workspace.tasks.filter((item) => !item.completed).length === 0 && <p className="hint">No open tasks.</p>}
        {workspace.tasks.filter((item) => !item.completed).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')).map((item) =>
          <div key={item.id} className="task-row">
            <button title="Mark completed" onClick={() => void changeCompletion(item)}>☐</button>
            <div><strong>{item.title}</strong><small>{item.due ? `Due ${item.due} · ` : ''}{item.relatedEntityIds.map((id) => workspace.entities.find((entity) => entity.id === id)?.title).filter(Boolean).join(', ')}</small></div>
            <button className="text-button" onClick={() => setDraft(item)}>Edit</button>
            <button className="text-button" onClick={() => void archive(item)}>Archive</button>
          </div>)}
        <h2>Completed</h2>
        {workspace.tasks.filter((item) => item.completed).map((item) => <div key={item.id} className="task-row complete">
          <button title="Reopen task" onClick={() => void changeCompletion(item)}>☑</button><strong>{item.title}</strong>
          <button className="text-button" onClick={() => void archive(item)}>Archive</button>
        </div>)}
        {workspace.archivedTasks.length > 0 && <details className="archived-items"><summary>Archived tasks ({workspace.archivedTasks.length})</summary>
          {workspace.archivedTasks.map((item) => <div key={item.id}><span>{item.title}</span><button onClick={() => void window.serenity.restoreTask(item.id).then(onUpdate).catch((cause) => onError(String(cause)))}>Restore</button></div>)}
        </details>}
      </div>
      <aside className="module-aside">
        <form className="module-form" onSubmit={(event) => void save(event)}>
          <h3>{draft.id ? 'Edit task' : 'Add task'}</h3>
          <label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
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
