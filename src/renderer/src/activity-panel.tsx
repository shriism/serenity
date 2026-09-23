import type { WorkspaceSnapshot } from '../../shared/types'

interface ActivityItem { id: string; at: string; title: string; detail: string }

export function ActivityPanel({ workspace, activity }: { workspace: WorkspaceSnapshot; activity: ActivityItem[] }) {
  const requests = [...workspace.providerActivity].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return <section className="page">
    <span className="eyebrow">WORKSPACE HISTORY</span><h1>Activity</h1>
    <p>Follow knowledge changes and inspect which records provider requests used. Prompt contents are not duplicated in the activity log.</p>
    {requests.length > 0 && <div className="provider-activity">
      <h2>AI provider requests</h2>
      {requests.map((entry) => {
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
    </div>}
    {activity.length === 0 && <p className="hint">Your workspace history will appear here.</p>}
    {activity.map((item) => <article key={item.id} className="activity-row">
      <time>{item.at ? new Date(item.at).toLocaleString() : 'Date unknown'}</time>
      <div><strong>{item.title}</strong><p>{item.detail}</p></div>
    </article>)}
  </section>
}
