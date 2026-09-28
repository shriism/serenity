import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { citesDocument } from '../../shared/provenance'
import { MarkdownEditor, type EditorContext, type EditorHandle } from './markdown-editor'
import { documentOutline } from '../../shared/document-outline'
import { useAutosave } from './use-autosave'
import { ConflictBar, SaveIndicator } from './workspace-page'

/** Markdown and plain-text documents are edited in place; other formats are read through text extraction. */
export const isEditableDocument = (name: string): boolean => /\.(md|markdown|txt)$/i.test(name)

function LoadedDocument({ name, text, revision, workspace, context, onUpdate, onError, onOpen, onReview }: {
  name: string; text: string; revision: string; workspace: WorkspaceSnapshot; context: EditorContext
  onUpdate(snapshot: WorkspaceSnapshot): void; onError(message: string): void; onOpen(name: string): void; onReview(): void
}) {
  const { draft, setDraft, state, flush, resolve } = useAutosave({
    saved: text, revision, onUpdate, onError, revisionOf: () => undefined,
    save: (next, base) => window.serenity.saveDocumentText(name, next, base ?? revision)
  })
  const editor = useRef<EditorHandle | null>(null)
  const outline = useMemo(() => documentOutline(name, draft), [name, draft])
  const pending = workspace.proposals.filter((item) => item.status === 'pending' && citesDocument(item.source, name)).length
  return <article className="document-view" aria-label={name}>
    <SaveIndicator state={state}/>
    <ConflictBar state={state} what="document" onResolve={resolve}/>
    <header className="document-title-row">
      <h1 className="document-file-title">{name}</h1>
      <button type="button" className="icon-btn" onClick={() => onOpen(name)} aria-label="Open in default app" title="Open in default app"><ExternalLink size={15}/></button>
    </header>
    {pending > 0 && <div className="callout"><span>{pending} {pending === 1 ? 'suggestion from this document is' : 'suggestions from this document are'} waiting for review.</span>
      <button className="text-button" onClick={onReview}>Review</button></div>}
    {outline.length > 1 && <details className="document-outline"><summary>Outline · {outline.length} sections</summary>
      <nav aria-label={`Sections in ${name}`}><ol>{outline.map((heading) => <li key={heading.start}>
        <button type="button" style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }} onClick={() => editor.current?.goTo(heading.start)}>{heading.title}</button>
      </li>)}</ol></nav></details>}
    <MarkdownEditor handle={editor} value={draft} onChange={setDraft} onBlur={() => void flush()} context={context} label={`${name} text`}
      placeholder="Start writing. Type [[ to link a page, entity, or document." autoFocus={!text}/>
  </article>
}

/** Loads a text document for editing, and reloads it when the workspace changes so edits made elsewhere show up. */
export function DocumentEditor(props: { name: string; workspace: WorkspaceSnapshot; context: EditorContext
  onUpdate(snapshot: WorkspaceSnapshot): void; onError(message: string): void; onOpen(name: string): void; onReview(): void }) {
  const [loaded, setLoaded] = useState<{ name: string; text: string; revision: string } | null>(null)
  useEffect(() => {
    let current = true
    window.serenity.readEditableDocument(props.name).then((value) => { if (current) setLoaded({ name: props.name, ...value }) }, (error) => props.onError(String(error)))
    return () => { current = false }
  }, [props.name, props.workspace.generation])
  if (!loaded || loaded.name !== props.name) return <p className="hint document-loading">Opening {props.name}…</p>
  return <LoadedDocument key={props.name} {...props} text={loaded.text} revision={loaded.revision}/>
}
