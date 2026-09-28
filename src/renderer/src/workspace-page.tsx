import { useEffect, useMemo, useRef, useState } from 'react'
import YAML from 'yaml'
import type { WorkspacePage, WorkspaceSnapshot } from '../../shared/types'
import { resourceUri } from '../../shared/resources'
import { wikilinkMentions } from '../../shared/wikilinks'
import { MarkdownEditor, type EditorContext, type EditorHandle } from './markdown-editor'
import { useAutosave, type SaveState } from './use-autosave'

/** The frontmatter of `text` with its title replaced; other fields and comments stay as written. */
function withTitle(text: string, body: string, title: string, original: string): string {
  const prefix = text.slice(0, text.length - body.length)
  if (title === original) return prefix
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---/.exec(prefix)?.[1]
  if (yaml === undefined) return prefix
  const document = YAML.parseDocument(yaml)
  document.set('title', title)
  return `---\n${document.toString()}---\n`
}

/** A quiet note that edits are being saved, and briefly that they were; autosave should never feel like guesswork. */
export function SaveIndicator({ state }: { state: SaveState }) {
  const [justSaved, setJustSaved] = useState(false)
  const previous = useRef(state)
  useEffect(() => {
    const was = previous.current
    previous.current = state
    if (state === 'saved' && (was === 'saving' || was === 'pending')) {
      setJustSaved(true)
      const timer = window.setTimeout(() => setJustSaved(false), 1600)
      return () => window.clearTimeout(timer)
    }
  }, [state])
  const text = state === 'pending' || state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : justSaved ? 'Saved' : ''
  return <span className={`save-indicator ${text ? 'shown' : ''} ${state === 'error' ? 'error' : ''}`} role="status" aria-live="polite">{text}</span>
}

/** A conflict between this editor's text and a newer version on disk, with a choice rather than a silent overwrite. */
export function ConflictBar({ state, what, onResolve }: { state: SaveState; what: string; onResolve(keepMine: boolean): void }) {
  if (state !== 'conflict') return null
  return <div className="callout warning conflict-bar" role="alert">
    <span>This {what} changed on disk while you were editing it.</span>
    <button className="secondary" onClick={() => onResolve(false)}>Use the version on disk</button>
    <button className="primary" onClick={() => onResolve(true)}>Keep my version</button>
  </div>
}

/** A workspace page, always editable: its title inline, its Markdown in live preview, saved as you go. */
export function WorkspacePageView({ page, workspace, context, onUpdate, onError }: {
  page: WorkspacePage
  workspace: WorkspaceSnapshot
  context: EditorContext
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
}) {
  const saved = useMemo(() => ({ title: page.title, body: page.body }), [page.title, page.body])
  const { draft, setDraft, state, flush, resolve } = useAutosave({
    saved, revision: page.revision, onUpdate, onError,
    revisionOf: (snapshot) => snapshot.pages.find((item) => item.id === page.id)?.revision,
    save: (next, base) => window.serenity.savePage({ id: page.id, path: page.path, revision: base ?? page.revision,
      text: withTitle(page.text, page.body, next.title.trim() || page.title, page.title) + next.body })
  })
  const [title, setTitle] = useState(draft.title)
  useEffect(() => setTitle(draft.title), [draft.title])
  const body = useRef<EditorHandle | null>(null)
  const cancelTitle = useRef(false)

  async function commitTitle(): Promise<void> {
    const next = title.trim()
    if (!next) { setTitle(draft.title); return }
    if (next === draft.title) return
    const previous = draft.title
    const mentions = wikilinkMentions(workspace, resourceUri({ kind: 'page', id: page.id }))
    setDraft({ ...draft, title: next })
    await flush()
    if (mentions.length && window.confirm(`${mentions.length} ${mentions.length === 1 ? 'note links' : 'notes link'} to [[${previous}]]. Update ${mentions.length === 1 ? 'it' : 'them'} to [[${next}]]?`)) {
      try { onUpdate((await window.serenity.renameWikilinks(previous, next, mentions.map((mention) => mention.uri))).snapshot) }
      catch (cause) { onError(`Links were not updated: ${String(cause)}`) }
    }
  }

  return <article className="document-view page-document" aria-label={draft.title}>
    <SaveIndicator state={state}/>
    <ConflictBar state={state} what="page" onResolve={resolve}/>
    <input className="inline-title" value={title} aria-label="Page title" spellCheck={false}
      onChange={(event) => setTitle(event.target.value)} onBlur={() => {
        if (cancelTitle.current) { cancelTitle.current = false; return }
        void commitTitle()
      }}
      onKeyDown={(event) => {
        // Enter continues into the page, as in a document editor; Escape puts the title back.
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); body.current?.focusStart() }
        else if (event.key === 'Escape') { event.preventDefault(); cancelTitle.current = true; setTitle(draft.title); event.currentTarget.blur() }
      }}/>
    <MarkdownEditor handle={body} value={draft.body} onChange={(text) => setDraft({ ...draft, body: text })} onBlur={() => void flush()} context={context}
      label={`${draft.title} text`} placeholder="Start writing. Type [[ to link a page, entity, or document."/>
  </article>
}
