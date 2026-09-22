import { useState, type FormEvent } from 'react'
import type { CalendarEvent, TaskItem, WorkspaceSnapshot } from '../../shared/types'

type ModuleProps = {
  workspace: WorkspaceSnapshot
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
}

function today(): string { return new Date().toLocaleDateString('en-CA') }

export function CalendarModule({ workspace, onUpdate, onError }: ModuleProps) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [selected, setSelected] = useState(today())
  const [draft, setDraft] = useState<CalendarEvent>({ id: '', title: '', start: today(), notes: '', relatedEntityIds: [] })
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [linked, setLinked] = useState('')
  const [busy, setBusy] = useState(false)
  const [year, number] = month.split('-').map(Number)
  const first = new Date(year, number - 1, 1).getDay()
  const count = new Date(year, number, 0).getDate()
  const days = Array.from({ length: first + count }, (_, index) => index < first ? null : `${month}-${String(index - first + 1).padStart(2, '0')}`)
  const selectedEvents = workspace.events.filter((event) => event.start.slice(0, 10) === selected)

  function changeMonth(offset: number) {
    const next = new Date(year, number - 1 + offset, 1)
    const value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
    setMonth(value)
    setSelected(`${value}-01`)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const start = `${draft.start.slice(0, 10)}${time ? `T${time}` : ''}`
      const end = endTime ? `${draft.start.slice(0, 10)}T${endTime}` : undefined
      const snapshot = await window.serenity.saveEvent({ ...draft, start, end, relatedEntityIds: linked ? [linked] : [] })
      onUpdate(snapshot)
      setSelected(start.slice(0, 10))
      setDraft({ id: '', title: '', start: selected, notes: '', relatedEntityIds: [] })
      setTime('')
      setEndTime('')
      setLinked('')
    } catch (cause) { onError(String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="page module-page"><span className="eyebrow">SERENITY CALENDAR</span><h1>Calendar</h1><p>Events live in this workspace and can connect to anything in your knowledge.</p><div className="calendar-layout"><div><div className="calendar-toolbar"><button onClick={() => changeMonth(-1)}>←</button><h2>{new Date(year, number - 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2><button onClick={() => changeMonth(1)}>→</button></div><div className="calendar-grid">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="weekday" key={day}>{day}</span>)}{days.map((day, index) => day ? <button key={day} className={day === selected ? 'selected' : ''} onClick={() => { setSelected(day); if (!draft.id) setDraft({ ...draft, start: day }) }}><strong>{Number(day.slice(-2))}</strong>{workspace.events.filter((item) => item.start.slice(0, 10) === day).map((item) => <small key={item.id}>{item.title}</small>)}{workspace.modules.tasks && workspace.tasks.filter((item) => item.due === day && !item.completed).map((item) => <small key={item.id}>☐ {item.title}</small>)}</button> : <span key={`empty-${index}`} />)}</div></div><aside className="module-aside"><h2>{new Date(`${selected}T12:00`).toLocaleDateString(undefined, { dateStyle: 'full' })}</h2>{selectedEvents.length === 0 && <p className="hint">No events on this day.</p>}{selectedEvents.map((item) => <button key={item.id} className="module-record" onClick={() => { setDraft(item); setTime(item.start.slice(11, 16)); setEndTime(item.end?.slice(11, 16) ?? ''); setLinked(item.relatedEntityIds[0] ?? '') }}><strong>{item.title}</strong><small>{item.start.slice(11) || 'All day'} · {item.relatedEntityIds.map((id) => workspace.entities.find((entity) => entity.id === id)?.title).filter(Boolean).join(', ')}</small></button>)}<form className="module-form" onSubmit={(event) => void save(event)}><h3>{draft.id ? 'Edit event' : 'Add event'}</h3><label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label><label>Date<input type="date" required value={draft.start.slice(0, 10)} onChange={(event) => setDraft({ ...draft, start: event.target.value })}/></label><label>Start time (optional)<input type="time" value={time} onChange={(event) => setTime(event.target.value)}/></label><label>End time (optional)<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)}/></label><label>Connect to knowledge<select value={linked} onChange={(event) => setLinked(event.target.value)}><option value="">None</option>{workspace.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select></label><label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label><button className="primary" type="submit" disabled={busy}>Save event</button>{draft.id && <button className="text-button" type="button" onClick={() => { setDraft({ id: '', title: '', start: selected, notes: '', relatedEntityIds: [] }); setTime(''); setEndTime(''); setLinked('') }}>Cancel editing</button>}</form></aside></div></section>
}

export function TasksModule({ workspace, onUpdate, onError }: ModuleProps) {
  const [draft, setDraft] = useState<TaskItem>({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] })
  const [linked, setLinked] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      onUpdate(await window.serenity.saveTask({ ...draft, relatedEntityIds: linked ? [linked] : [] }))
      setDraft({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] })
      setLinked('')
    } catch (cause) { onError(String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="page module-page"><span className="eyebrow">SERENITY TASKS</span><h1>Tasks</h1><p>Plan what matters and connect it to your people, projects, or any other entities.</p><div className="tasks-layout"><div><h2>To do</h2>{workspace.tasks.filter((item) => !item.completed).length === 0 && <p className="hint">No open tasks.</p>}{workspace.tasks.filter((item) => !item.completed).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')).map((item) => <div key={item.id} className="task-row"><button title="Mark completed" onClick={() => void window.serenity.saveTask({ ...item, completed: true }).then(onUpdate).catch((cause) => onError(String(cause)))}>☐</button><div><strong>{item.title}</strong><small>{item.due ? `Due ${item.due} · ` : ''}{item.relatedEntityIds.map((id) => workspace.entities.find((entity) => entity.id === id)?.title).filter(Boolean).join(', ')}</small></div><button className="text-button" onClick={() => { setDraft(item); setLinked(item.relatedEntityIds[0] ?? '') }}>Edit</button></div>)}<h2>Completed</h2>{workspace.tasks.filter((item) => item.completed).map((item) => <div key={item.id} className="task-row complete"><button title="Reopen task" onClick={() => void window.serenity.saveTask({ ...item, completed: false }).then(onUpdate).catch((cause) => onError(String(cause)))}>☑</button><strong>{item.title}</strong></div>)}</div><aside className="module-aside"><form className="module-form" onSubmit={(event) => void save(event)}><h3>{draft.id ? 'Edit task' : 'Add task'}</h3><label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label><label>Due date<input type="date" value={draft.due ?? ''} onChange={(event) => setDraft({ ...draft, due: event.target.value || undefined })}/></label><label>Connect to knowledge<select value={linked} onChange={(event) => setLinked(event.target.value)}><option value="">None</option>{workspace.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select></label><label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label><button className="primary" type="submit" disabled={busy}>Save task</button>{draft.id && <button className="text-button" type="button" onClick={() => { setDraft({ id: '', title: '', completed: false, notes: '', relatedEntityIds: [] }); setLinked('') }}>Cancel editing</button>}</form></aside></div></section>
}
