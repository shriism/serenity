import { useEffect, useState, isValidElement } from 'react'
import { ArrowUpRight, Pencil, Save, X } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import YAML from 'yaml'
import type { WorkspacePage, WorkspaceSnapshot } from '../../shared/types'
import { evaluateWorkspaceQuery } from '../../shared/query'
import { parseResourceUri } from '../../shared/resources'
import type { CommandContribution } from './commands'

function LiveQuery({ source, workspace, onOpen }: { source: string; workspace: WorkspaceSnapshot; onOpen(uri: string, side?: boolean): void }) {
  try {
    const result = evaluateWorkspaceQuery(workspace, YAML.parse(source) as unknown)
    const kind = result.source === 'upcoming' ? 'home-list' : result.source === 'claims' ? 'home-recent-list' :
      result.source === 'proposals' ? 'home-review-list' : 'page-query-list'
    return result.items.length ? <div className={`page-query-list ${kind}`}>{result.items.map((item) => <button key={item.uri} onClick={(event) => onOpen(item.uri, event.metaKey || event.ctrlKey)} title="Open (⌘/Ctrl-click to open to the side)">
      <span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowUpRight size={15}/>
    </button>)}</div> : <p className="page-query-empty">Nothing here yet.</p>
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

  const urlTransform = (url: string): string => parseResourceUri(url) || /^serenity:command\/[a-z0-9.-]+$/.test(url) ? url : defaultUrlTransform(url)

  return <section className="workspace-page home-page" aria-label={page.title}>
    <header className="page-toolbar"><span title={page.path}>{page.path}</span><div>
      {editing ? <><button onClick={cancel} disabled={busy}><X size={15}/> Cancel</button><button className="page-save" onClick={() => void save()} disabled={busy || !dirty}><Save size={15}/> Save page</button></>
        : <button onClick={() => { setBaseRevision(page.revision); setEditing(true) }}><Pencil size={15}/> Edit page</button>}
    </div></header>
    {editing ? <div className="page-source"><label htmlFor="page-source">Markdown with YAML frontmatter</label><textarea id="page-source" value={draft} disabled={busy}
      onChange={(event) => { setDraft(event.target.value); setDirty(event.target.value !== page.text) }} spellCheck={false}/><small>Changes to this file stay in {page.path}. Query blocks read this workspace only.</small></div>
      : <article className="page-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={{
        a: ({ children, href }) => {
          const ref = href ? parseResourceUri(href) : null
          if (ref) return <button className="page-link" onClick={(event) => onOpen(href!, event.metaKey || event.ctrlKey)}>{children}<ArrowUpRight size={14}/></button>
          const command = href?.startsWith('serenity:command/') ? decodeURIComponent(href.slice('serenity:command/'.length)) : null
          if (command && commands.some((item) => item.id === command)) return <button className="page-link" onClick={() => onCommand(command)}>{children}<ArrowUpRight size={14}/></button>
          return <span title={href}>{children}</span>
        },
        code: ({ className, children }) => className === 'language-serenity-query' ?
          <LiveQuery source={String(children).trim()} workspace={workspace} onOpen={onOpen}/> : <code className={className}>{children}</code>,
        pre: ({ children }) => isValidElement(children) && children.type === LiveQuery ? <>{children}</> : <pre>{children}</pre>,
        img: ({ alt }) => <span className="preview-image">[Image: {alt || 'no description'}]</span>
      }}>{page.body}</ReactMarkdown></article>}
  </section>
}
