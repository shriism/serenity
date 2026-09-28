import YAML from 'yaml'
import type { WorkspaceSnapshot } from '../../shared/types'
import { evaluateWorkspaceQuery } from '../../shared/query'

// What a newcomer needs to know about each empty list: how things get there.
const emptyMessages: Record<string, string> = {
  upcoming: 'Nothing scheduled. Tasks with due dates and calendar events appear here.',
  proposals: 'No suggestions waiting. Ask the assistant, or analyze an imported document, and its suggestions appear here for review.',
  claims: 'No facts yet. Open or create an entity and add a sourced claim, such as a birthday or who someone works with.',
  entities: 'No entities yet. Create one for a person, project, place, or idea.',
  documents: 'No documents yet. Import files; they are copied into this workspace.',
  tasks: 'No tasks yet.', events: 'No events yet.', pages: 'No pages yet.', activity: 'Nothing has happened in this workspace yet.'
}

/** The result of a `serenity-query` block: a bounded list, table, or count of this workspace's records. */
export function LiveQuery({ source, workspace, onOpen }: { source: string; workspace: WorkspaceSnapshot; onOpen(uri: string, side: boolean): void }) {
  try {
    const result = evaluateWorkspaceQuery(workspace, YAML.parse(source) as unknown)
    if (result.display === 'count') return <p className="page-query-count"><strong>{result.total}</strong></p>
    if (!result.items.length) return <p className="page-query-empty">{emptyMessages[result.source] ?? 'Nothing matches yet.'}</p>
    const open = (uri: string) => (event: { metaKey: boolean; ctrlKey: boolean }) => onOpen(uri, event.metaKey || event.ctrlKey)
    const more = result.total > result.items.length ? <p className="page-query-more">Showing {result.items.length} of {result.total}</p> : null
    if (result.display === 'table') return <><table className="page-query-table"><tbody>{result.items.map((item) => <tr key={item.uri}>
      <td><button className="page-link" onClick={open(item.uri)}>{item.title}</button></td><td>{item.detail}</td></tr>)}</tbody></table>{more}</>
    return <><ul className="page-query-list">{result.items.map((item) => <li key={item.uri}>
      <button onClick={open(item.uri)} title="Open (⌘/Ctrl-click to open in the next pane)"><span className="query-title">{item.title}</span><span className="query-detail">{item.detail}</span></button>
    </li>)}</ul>{more}</>
  } catch (error) { return <p className="page-query-error" role="alert">Query: {String(error)}</p> }
}
