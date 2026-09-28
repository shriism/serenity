import { useEffect, useRef, type MutableRefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorSelection, EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view'
import { cursorLineDown, cursorLineUp, defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, ensureSyntaxTree, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import type { WorkspaceSnapshot } from '../../shared/types'
import { resolveWikilink, wikilinkSuggestions } from '../../shared/wikilinks'
import { parseResourceUri } from '../../shared/resources'
import { externalLink } from '../../shared/external-links'
import { LiveQuery } from './live-query'
import { preferences } from './preferences'

/** What the editor needs from the workbench: the workspace to resolve links against, and how to follow them. */
export interface EditorContext {
  workspace: WorkspaceSnapshot
  open(uri: string, side: boolean): void
  command(id: string): void
}

const setContext = StateEffect.define<EditorContext>()
const setFocused = StateEffect.define<boolean>()
// Syntax is revealed only where the cursor is while the editor has focus; an unfocused page reads as a document.
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => transaction.effects.reduce((current, effect) => effect.is(setFocused) ? effect.value : current, value)
})
const contextField = StateField.define<EditorContext | null>({
  create: () => null,
  update: (value, transaction) => transaction.effects.reduce((current, effect) => effect.is(setContext) ? effect.value : current, value)
})

/** Follows a link written in Markdown: a workspace resource, a command, or a web or email address. */
function follow(context: EditorContext, href: string, side: boolean): void {
  if (parseResourceUri(href)) context.open(href, side)
  else if (href.startsWith('serenity:command/')) context.command(decodeURIComponent(href.slice('serenity:command/'.length)))
  else if (externalLink(href)) void window.serenity.openExternal(href)
}

class BulletWidget extends WidgetType {
  eq(): boolean { return true }
  toDOM(): HTMLElement { const span = document.createElement('span'); span.className = 'cm-bullet'; span.textContent = '•'; return span }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly at: number) { super() }
  eq(other: CheckboxWidget): boolean { return other.checked === this.checked && other.at === this.at }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-task'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Mark not done' : 'Mark done')
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return box
  }
  ignoreEvent(): boolean { return false }
}

class RuleWidget extends WidgetType {
  eq(): boolean { return true }
  toDOM(): HTMLElement { const hr = document.createElement('span'); hr.className = 'cm-rule'; return hr }
}

/** A `serenity-query` block shown as its live result while the cursor is outside its source. */
class QueryWidget extends WidgetType {
  constructor(readonly source: string, readonly context: EditorContext) { super() }
  eq(other: QueryWidget): boolean { return other.source === this.source && other.context === this.context }
  private render(root: Root, dom: HTMLElement, view: EditorView): void {
    root.render(<div className="cm-query-card" onMouseDown={(event) => {
      if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
      event.preventDefault()
      const at = view.posAtDOM(dom)
      view.dispatch({ selection: { anchor: at } })
      view.focus()
    }}>
      <LiveQuery source={this.source} workspace={this.context.workspace} onOpen={this.context.open}/>
    </div>)
  }
  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-query'
    const root = createRoot(dom)
    ;(dom as HTMLElement & { queryRoot?: Root }).queryRoot = root
    this.render(root, dom, view)
    return dom
  }
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const root = (dom as HTMLElement & { queryRoot?: Root }).queryRoot
    if (!root) return false
    this.render(root, dom, view)
    return true
  }
  destroy(dom: HTMLElement): void {
    const root = (dom as HTMLElement & { queryRoot?: Root }).queryRoot
    // Unmounting during CodeMirror's update would re-enter React's render; do it afterwards.
    if (root) setTimeout(() => root.unmount())
  }
  ignoreEvent(): boolean { return true }
  get estimatedHeight(): number { return 120 }
}

const wikilink = /(?<!!)\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(?:\|([^[\]\n]+))?\]\]/g
const hidden = Decoration.replace({})

/**
 * Live preview: Markdown syntax is hidden and styled in place, except in the parts of the text the cursor is on, so
 * what you read is what you edit. Query blocks become their results. Nothing here changes the text itself.
 */
function livePreview(state: EditorState): DecorationSet {
  const context = state.field(contextField)
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state)
  const ranges = state.selection.ranges
  const focused = state.field(focusField)
  const touches = (from: number, to: number): boolean => focused && ranges.some((range) => range.from <= to && range.to >= from)
  const lineTouched = (position: number): boolean => { const line = state.doc.lineAt(position); return touches(line.from, line.to) }
  const decorations: Range<Decoration>[] = []
  const skipped: [number, number][] = []
  const lineClass = (position: number, className: string): void => { decorations.push(Decoration.line({ class: className }).range(state.doc.lineAt(position).from)) }

  tree.iterate({ enter(node) {
    const { from, to, name } = node
    if (/^ATXHeading(\d)$/.test(name)) {
      lineClass(from, `cm-heading cm-h${name.slice(-1)}`)
      const mark = node.node.firstChild
      if (mark?.name === 'HeaderMark' && !lineTouched(from)) {
        const end = state.doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
        decorations.push(hidden.range(mark.from, end))
      }
      return
    }
    switch (name) {
      case 'FencedCode': {
        skipped.push([from, to])
        const info = node.node.getChild('CodeInfo')
        const language = info ? state.sliceDoc(info.from, info.to).trim() : ''
        if (language === 'serenity-query' && context && !touches(from, to)) {
          const text = node.node.getChild('CodeText')
          const start = state.doc.lineAt(from).from
          const end = state.doc.lineAt(to).to
          decorations.push(Decoration.replace({ widget: new QueryWidget(text ? state.sliceDoc(text.from, text.to) : '', context), block: true }).range(start, end))
          return false
        }
        const first = state.doc.lineAt(from).number
        const last = state.doc.lineAt(to).number
        for (let number = first; number <= last; number++)
          lineClass(state.doc.line(number).from, `cm-codeblock${number === first ? ' cm-codeblock-first' : ''}${number === last ? ' cm-codeblock-last' : ''}`)
        return false
      }
      case 'InlineCode':
        skipped.push([from, to])
        decorations.push(Decoration.mark({ class: 'cm-inline-code' }).range(from, to))
        if (!touches(from, to)) node.node.getChildren('CodeMark').forEach((mark) => decorations.push(hidden.range(mark.from, mark.to)))
        return false
      case 'Emphasis': case 'StrongEmphasis': case 'Strikethrough':
        decorations.push(Decoration.mark({ class: name === 'Emphasis' ? 'cm-em' : name === 'StrongEmphasis' ? 'cm-strong' : 'cm-strike' }).range(from, to))
        if (!touches(from, to)) for (const mark of [...node.node.getChildren('EmphasisMark'), ...node.node.getChildren('StrikethroughMark')]) decorations.push(hidden.range(mark.from, mark.to))
        return
      case 'Link': {
        const marks = node.node.getChildren('LinkMark')
        const url = node.node.getChild('URL')
        const href = url ? state.sliceDoc(url.from, url.to) : ''
        if (marks.length >= 2 && href) {
          const textEnd = marks[1].from
          decorations.push(Decoration.mark({ class: 'cm-link', attributes: { 'data-href': href, title: href } }).range(marks[0].to, textEnd))
          if (!touches(from, to)) { decorations.push(hidden.range(from, marks[0].to)); decorations.push(hidden.range(textEnd, to)) }
        }
        return false
      }
      case 'Autolink': case 'URL': {
        if (node.node.parent?.name === 'Link') return false
        const text = state.sliceDoc(from, to).replace(/^<|>$/g, '')
        decorations.push(Decoration.mark({ class: 'cm-link', attributes: { 'data-href': text } }).range(from, to))
        return false
      }
      case 'Blockquote': {
        const first = state.doc.lineAt(from).number
        const last = state.doc.lineAt(to).number
        for (let number = first; number <= last; number++) lineClass(state.doc.line(number).from, 'cm-quote')
        return
      }
      case 'QuoteMark':
        if (!lineTouched(from)) decorations.push(hidden.range(from, state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to))
        return
      case 'ListMark': {
        const bullet = /^[-*+]$/.test(state.sliceDoc(from, to))
        const task = node.node.parent?.getChild('Task')
        if (bullet && !task && !touches(from, to + 1)) decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to))
        return
      }
      case 'TaskMarker': {
        const checked = /x/i.test(state.sliceDoc(from, to))
        const listMark = node.node.parent?.parent?.getChild('ListMark')
        if (!touches(from, to)) decorations.push(Decoration.replace({ widget: new CheckboxWidget(checked, from) }).range(listMark && state.doc.lineAt(listMark.from).number === state.doc.lineAt(from).number ? listMark.from : from, to))
        if (checked) decorations.push(Decoration.line({ class: 'cm-task-done' }).range(state.doc.lineAt(from).from))
        return
      }
      case 'HorizontalRule':
        if (!lineTouched(from)) decorations.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to))
        return
    }
  } })

  // Wikilinks are Serenity's own syntax, so they are found in the prose rather than the Markdown tree.
  if (context) {
    const text = state.doc.toString()
    for (const match of text.matchAll(wikilink)) {
      const from = match.index
      const to = from + match[0].length
      if (skipped.some(([start, end]) => from < end && to > start)) continue
      const resolution = resolveWikilink(context.workspace, match[1])
      const labelStart = match[3] ? to - 2 - match[3].length : from + 2
      const labelEnd = match[3] ? to - 2 : from + 2 + match[1].length
      const attributes: Record<string, string> = resolution.kind === 'resolved' ? { 'data-href': resolution.uri, title: resolution.title } :
        { title: resolution.kind === 'ambiguous' ? `Several items are called this: ${resolution.titles.join(' · ')}` : `Nothing in this workspace is called “${match[1].trim()}” yet` }
      decorations.push(Decoration.mark({ class: `cm-wikilink ${resolution.kind}`, attributes }).range(labelStart, labelEnd))
      if (!touches(from, to)) { decorations.push(hidden.range(from, labelStart)); decorations.push(hidden.range(labelEnd, to)) }
    }
  }
  return Decoration.set(decorations, true)
}

const previewField = StateField.define<DecorationSet>({
  create: livePreview,
  update: (value, transaction) => transaction.docChanged || transaction.selection || transaction.effects.some((effect) => effect.is(setContext) || effect.is(setFocused)) ||
    syntaxTree(transaction.state) !== syntaxTree(transaction.startState) ? livePreview(transaction.state) : value,
  provide: (field) => EditorView.decorations.from(field)
})

function wikilinkCompletions(completion: CompletionContext): CompletionResult | null {
  const context = completion.state.field(contextField)
  const before = completion.matchBefore(/\[\[[^[\]|\n]*$/)
  if (!context || !before) return null
  const query = before.text.slice(2)
  const closed = completion.state.sliceDoc(completion.pos, completion.pos + 2) === ']]'
  return { from: before.from + 2, validFor: /^[^[\]|\n]*$/,
    options: wikilinkSuggestions(context.workspace, query, 20).map((item) => ({ label: item.title, detail: item.kind, apply: closed ? item.title : `${item.title}]]` })) }
}

/** Reveal a query's source when vertical cursor movement would otherwise step over its preview widget. */
function enterQueryWithArrow(forward: boolean) {
  return (view: EditorView): boolean => {
    const selection = view.state.selection.main
    if (!selection.empty) return false
    const destination = view.moveVertically(selection, forward).head
    const from = selection.head
    let target: number | null = null
    const tree = ensureSyntaxTree(view.state, Math.max(from, destination), 25) ?? syntaxTree(view.state)
    tree.iterate({ from: Math.min(from, destination), to: Math.max(from, destination), enter(node) {
      if (node.name !== 'FencedCode') return
      if (forward && target !== null) return false
      const info = node.node.getChild('CodeInfo')
      if (!info || view.state.sliceDoc(info.from, info.to).trim() !== 'serenity-query') return false
      const start = view.state.doc.lineAt(node.from).from
      const end = view.state.doc.lineAt(node.to).to
      if (forward ? from < start && destination >= start : from > end && destination <= end) {
        const source = node.node.getChild('CodeText')
        target = source ? (forward ? source.from : source.to) : (forward ? start : end)
      }
      return false
    } })
    if (target === null) return forward ? cursorLineDown(view) : cursorLineUp(view)
    view.dispatch({ selection: { anchor: target }, scrollIntoView: true })
    return true
  }
}

/** Wraps the selection in a Markdown marker, or removes it if already wrapped. */
function toggleMarker(marker: string) {
  return (view: EditorView): boolean => {
    view.dispatch(view.state.changeByRange((range) => {
      const before = view.state.sliceDoc(range.from - marker.length, range.from)
      const after = view.state.sliceDoc(range.to, range.to + marker.length)
      if (before === marker && after === marker) return { changes: [{ from: range.from - marker.length, to: range.from }, { from: range.to, to: range.to + marker.length }],
        range: EditorSelection.range(range.from - marker.length, range.to - marker.length) }
      return { changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }], range: EditorSelection.range(range.from + marker.length, range.to + marker.length) }
    }))
    return true
  }
}

const highlight = HighlightStyle.define([
  { tag: tags.monospace, class: 'cm-mono' },
  { tag: tags.processingInstruction, class: 'cm-syntax' },
  { tag: tags.meta, class: 'cm-syntax' },
  { tag: tags.comment, class: 'cm-comment' },
  { tag: tags.string, class: 'cm-string' },
  { tag: tags.keyword, class: 'cm-keyword' }
])

function extensions(placeholderText: string, label: string, onChange: (text: string) => void, onBlur: () => void): Extension[] {
  return [
    contextField, focusField, previewField, history(), EditorView.lineWrapping, highlightSelectionMatches(),
    markdown({ base: markdownLanguage, addKeymap: false }), syntaxHighlighting(highlight),
    autocompletion({ override: [wikilinkCompletions], icons: false }),
    keymap.of([{ key: 'Mod-b', run: toggleMarker('**') }, { key: 'Mod-i', run: toggleMarker('*') },
      { key: 'ArrowDown', run: enterQueryWithArrow(true) }, { key: 'ArrowUp', run: enterQueryWithArrow(false) },
      ...markdownKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap,
      // After suggestions and search have had their turn, Escape leaves the editor so the page reads without syntax.
      { key: 'Escape', run: (view) => { if (!preferences.get().escapeLeavesEditing) return false; view.contentDOM.blur(); return true } }]),
    placeholder(placeholderText),
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true' }),
    EditorView.updateListener.of((update) => { if (update.docChanged) onChange(update.state.doc.toString()) }),
    EditorView.domEventHandlers({
      focus: (_event, view) => { view.dispatch({ effects: setFocused.of(true) }); return false },
      blur: (_event, view) => { view.dispatch({ effects: setFocused.of(false) }); onBlur(); return false },
      mousedown: (event, view) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-href]')
        const context = view.state.field(contextField)
        if (!target || !context || event.button !== 0) return false
        // Plain clicks on links shown as links follow them; while their syntax is showing, clicks edit unless ⌘/Ctrl is held.
        const position = view.posAtDOM(target)
        const editing = view.hasFocus && view.state.selection.ranges.some((range) => range.from <= position + target.textContent!.length && range.to >= position)
        if (editing && !(event.metaKey || event.ctrlKey)) return false
        event.preventDefault()
        follow(context, target.dataset.href!, editing ? false : event.metaKey || event.ctrlKey)
        return true
      }
    })
  ]
}

/**
 * A Markdown editor with live preview. `value` is adopted when it changes from outside (for example, the file was
 * edited in another app) and differs from what the editor holds; typing reports through `onChange`.
 */
/** Lets a parent move the cursor into the editor, e.g. from a title field. */
export interface EditorHandle { focusStart(): void; goTo(position: number): void }

export function MarkdownEditor({ value, onChange, onBlur = () => undefined, context, placeholder: placeholderText = '', label, className = '', autoFocus = false, handle }: {
  value: string
  onChange(text: string): void
  onBlur?(): void
  context: EditorContext
  placeholder?: string
  label: string
  className?: string
  autoFocus?: boolean
  handle?: MutableRefObject<EditorHandle | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const handlers = useRef({ onChange, onBlur })
  handlers.current = { onChange, onBlur }

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: value, extensions: extensions(placeholderText, label, (text) => handlers.current.onChange(text), () => handlers.current.onBlur()) })
    })
    editor.dispatch({ effects: setContext.of(context) })
    view.current = editor
    if (autoFocus) editor.focus()
    if (handle) handle.current = {
      focusStart: () => { editor.focus(); editor.dispatch({ selection: { anchor: 0 }, scrollIntoView: true }) },
      goTo: (position) => { const anchor = Math.min(position, editor.state.doc.length); editor.focus(); editor.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'start', yMargin: 24 }) }) }
    }
    return () => { editor.destroy(); view.current = null; if (handle) handle.current = null }
  }, [])
  useEffect(() => { view.current?.dispatch({ effects: setContext.of(context) }) }, [context])
  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    // Keep the cursor near where it was when the text is replaced from outside.
    const head = Math.min(editor.state.selection.main.head, value.length)
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: { anchor: head } })
  }, [value])
  return <div ref={host} className={`markdown-editor ${className}`}/>
}
