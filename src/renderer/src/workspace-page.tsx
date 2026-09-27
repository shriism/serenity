import { useEffect, useMemo, useState, isValidElement } from 'react'
import { ArrowUpRight, Pencil, Save, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import YAML from 'yaml'
import type { WorkspacePage, WorkspaceSnapshot } from '../../shared/types'
import { evaluateWorkspaceQuery } from '../../shared/query'
import { linkWikilinks, resolveWikilink } from '../../shared/wikilinks'
import { markdownUrlTransform, workspaceLink } from './markdown-links'
import { WikilinkTextarea } from './wikilink-textarea'
import type { CommandContribution } from './commands'

// What a newcomer needs to know about each empty list: how things get there.
const emptyMessages: Record<string, string> = {
  upcoming: 'Nothing scheduled. Tasks with due dates and calendar events appear here.',
  proposals: 'No suggestions waiting. Ask the assistant, or analyze an imported document, and its suggestions appear here for review.',
  claims: 'No facts yet. Open or create an entity and add a sourced claim, such as a birthday or who someone works with.',
  entities: 'No entities yet. Create one for a person, project, place, or idea.',
  documents: 'No documents yet. Import files from Documents; they are copied into this workspace.',
  tasks: 'No tasks yet.', events: 'No events yet.', pages: 'No pages yet.', activity: 'Nothing has happened in this workspace yet.'
}

function LiveQuery({ source, workspace, onOpen }: { source: string; workspace: WorkspaceSnapshot; onOpen(uri: string, side?: boolean): void }) {
  try {
    const result = evaluateWorkspaceQuery(workspace, YAML.parse(source) as unknown)
    if (result.display === 'count') return <p className="page-query-count"><strong>{result.total}</strong></p>
    if (!result.items.length) return <p className="page-query-empty">{emptyMessages[result.source] ?? 'Nothing matches yet.'}</p>
    const open = (uri: string) => (event: { metaKey: boolean; ctrlKey: boolean }) => onOpen(uri, event.metaKey || event.ctrlKey)
    const more = result.total > result.items.length ? <p className="page-query-more">Showing {result.items.length} of {result.total}.</p> : null
    if (result.display === 'table') return <><table className="page-query-table"><tbody>{result.items.map((item) => <tr key={item.uri}>
      <td><button className="page-link" onClick={open(item.uri)}>{item.title}</button></td><td>{item.detail}</td></tr>)}</tbody></table>{more}</>
    const kind = result.source === 'upcoming' ? 'home-list' : result.source === 'claims' ? 'home-recent-list' :
      result.source === 'proposals' ? 'home-review-list' : 'page-query-list'
    return <><div className={`page-query-list ${kind}`}>{result.items.map((item) => <button key={item.uri} onClick={open(item.uri)} title="Open (⌘/Ctrl-click to open to the side)">
      <span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowUpRight size={15}/>
    </button>)}</div>{more}</>
  } catch (error) { return <p className="page-query-error" role="alert">Query: {String(error)}</p> }
}

export function WorkspacePageView({ page, workspace, commands, onUpdate, onError, onDirtyChange, onOpen, onCommand }: {
  page: WorkspacePage
  workspace: WorkspaceSnapshot
  commands: CommandContribution[]
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
  onDirtyChange(dirty: boolean): void
  /** `side` opens the resource in the other editor group. */
  onOpen(uri: string, side?: boolean): void
  onCommand(id: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(page.text)
  const [dirty, setDirty] = useState(false)
  const [baseRevision, setBaseRevision] = useState(page.revision)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!dirty) { setDraft(page.text); setBaseRevision(page.revision) } }, [page.text, page.revision, page.id, dirty])
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  async function save(): Promise<void> {
    if (busy || !dirty) return
    setBusy(true)
    try {
      onUpdate(await window.serenity.savePage({ id: page.id, path: page.path, text: draft, revision: baseRevision }))
      setDirty(false)
      setEditing(false)
      onError('')
    } catch (error) { onError(String(error)) }
    finally { setBusy(false) }
  }

  function cancel(): void {
    if (dirty && !window.confirm('Discard unsaved page changes?')) return
    setDraft(page.text)
    setDirty(false)
    setEditing(false)
  }

  const body = useMemo(() => linkWikilinks(page.body, (target) => resolveWikilink(workspace, target)), [page.body, workspace.pages, workspace.entities, workspace.documents])

  return <section className="workspace-page home-page" aria-label={page.title}>
    <header className="page-toolbar"><span title={page.path}>{page.path}</span><div>
      {editing ? <><button onClick={cancel} disabled={busy}><X size={15}/> Cancel</button><button className="page-save" onClick={() => void save()} disabled={busy || !dirty}><Save size={15}/> Save page</button></>
        : <button onClick={() => { setBaseRevision(page.revision); setEditing(true) }}><Pencil size={15}/> Edit page</button>}
    </div></header>
    {editing ? <div className="page-source"><label htmlFor="page-source">Markdown with YAML frontmatter</label><WikilinkTextarea id="page-source" value={draft} disabled={busy} workspace={workspace}
      onValueChange={(text) => { setDraft(text); setDirty(text !== page.text) }} spellCheck={false}/><small>Changes to this file stay in {page.path}. Query blocks read this workspace only.</small></div>
      : <article className="page-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform} components={{
        a: ({ children, href }) => {
          const link = workspaceLink(href, children, onOpen)
          if (link) return link
          const command = href?.startsWith('serenity:command/') ? decodeURIComponent(href.slice('serenity:command/'.length)) : null
          if (command && commands.some((item) => item.id === command)) return <button className="page-link" onClick={() => onCommand(command)}>{children}<ArrowUpRight size={14}/></button>
          return <span title={href}>{children}</span>
        },
        code: ({ className, children }) => className === 'language-serenity-query' ?
          <LiveQuery source={String(children).trim()} workspace={workspace} onOpen={onOpen}/> : <code className={className}>{children}</code>,
        pre: ({ children }) => isValidElement(children) && children.type === LiveQuery ? <>{children}</> : <pre>{children}</pre>,
        img: ({ alt }) => <span className="preview-image">[Image: {alt || 'no description'}]</span>
      }}>{body}</ReactMarkdown></article>}
  </section>
}
