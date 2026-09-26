import { useMemo, useState } from 'react'
import { ArrowUpRight, Search } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { activityDay, activityKinds, type ActivityItem, type ActivityKind } from '../../shared/activity'

const page = 200

export function ActivityPanel({ workspace, activity, onOpenResource }: {
  workspace: WorkspaceSnapshot
  activity: ActivityItem[]
  /** `side` opens the record in the next pane. */
  onOpenResource(uri: string, side: boolean): void
}) {
  const [kinds, setKinds] = useState<ReadonlySet<ActivityKind>>(new Set())
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(page)
  const [requestLimit, setRequestLimit] = useState(20)
  const requests = useMemo(() => [...workspace.providerActivity].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [workspace.providerActivity])
  const shown = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase()
    return activity.filter((item) => (!kinds.size || kinds.has(item.kind)) && (!wanted || `${item.title} ${item.detail}`.toLocaleLowerCase().includes(wanted)))
  }, [activity, kinds, query])
  const toggle = (kind: ActivityKind): void => {
    setKinds((current) => { const next = new Set(current); if (next.has(kind)) next.delete(kind); else next.add(kind); return next })
    setLimit(page)
  }
  const now = new Date()
  return <section className="page activity-page">
    <span className="eyebrow">WORKSPACE HISTORY</span><h1>Activity</h1>
    <p>Follow knowledge changes and inspect which records provider requests used. Prompt contents are not duplicated in the activity log.</p>
    {requests.length > 0 && <div className="provider-activity">
      <h2>AI provider requests</h2>
      {requests.slice(0, requestLimit).map((entry) => {
        const interrupted = entry.status === 'running' && Date.now() - Date.parse(entry.startedAt) > 300000
        return <details key={entry.id}>
          <summary><strong>{entry.provider} · {entry.operation} · {interrupted ? 'possibly interrupted' : entry.status}</strong>
            <small>{new Date(entry.startedAt).toLocaleString()} · {entry.promptCharacters} characters sent</small></summary>
          <p>Prompt SHA-256: {entry.promptChecksum}</p>
          {entry.error && <p>Error: {entry.error}</p>}
          <p>Referenced workspace records ({entry.refs.length}):</p>
          {entry.refs.map((ref) => <small key={ref}>{ref}</small>)}
        </details>
      })}
      {requests.length > requestLimit && <button className="text-button" onClick={() => setRequestLimit((value) => value + 20)}>Show more requests ({requests.length - requestLimit})</button>}
    </div>}
    <div className="library-filter">
      <label className="library-search"><Search size={15}/><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(page) }} placeholder="Filter activity" aria-label="Filter activity"/></label>
      <div className="library-types" role="group" aria-label="Kinds of activity">
        {activityKinds.filter(({ kind }) => activity.some((item) => item.kind === kind)).map(({ kind, label }) =>
          <button key={kind} className={kinds.has(kind) ? 'active' : ''} aria-pressed={kinds.has(kind)} onClick={() => toggle(kind)}>{label}</button>)}
      </div>
    </div>
    {activity.length === 0 ? <p className="hint">Your workspace history will appear here.</p> : shown.length === 0 && <p className="hint">Nothing matches.</p>}
    {shown.slice(0, limit).map((item, index, list) => {
      const day = activityDay(item.at, now)
      return <div key={item.id}>
        {(index === 0 || activityDay(list[index - 1].at, now) !== day) && <h2 className="activity-day">{day}</h2>}
        <article className={`activity-row kind-${item.kind}`}>
          <time>{item.at && !Number.isNaN(Date.parse(item.at)) ? new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</time>
          <div>{item.uri ? <button className="activity-title" onClick={(event) => onOpenResource(item.uri!, event.metaKey || event.ctrlKey)}>{item.title} <ArrowUpRight size={12}/></button> : <strong>{item.title}</strong>}
            <p>{item.detail}</p></div>
        </article>
      </div>
    })}
    {shown.length > limit && <button className="secondary" onClick={() => setLimit((value) => value + page)}>Show more ({shown.length - limit})</button>}
  </section>
}
