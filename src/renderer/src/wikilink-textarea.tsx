import { useId, useMemo, useRef, useState, type TextareaHTMLAttributes } from 'react'
import type { WorkspaceSnapshot } from '../../shared/types'
import { completeWikilink, wikilinkQueryAt, wikilinkSuggestions } from '../../shared/wikilinks'

/** A Markdown textarea that suggests page, entity, and document titles after `[[`. */
export function WikilinkTextarea({ value, onValueChange, workspace, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange(value: string): void
  workspace: Pick<WorkspaceSnapshot, 'pages' | 'entities' | 'documents'>
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  const listId = useId()
  const suggestions = useMemo(() => query ? wikilinkSuggestions(workspace, query.query) : [], [query, workspace.pages, workspace.entities, workspace.documents])
  const open = Boolean(query && suggestions.length)
  const track = (element: HTMLTextAreaElement): void => {
    const next = element.selectionStart === element.selectionEnd ? wikilinkQueryAt(element.value, element.selectionStart) : null
    setQuery((current) => current?.start === next?.start && current?.query === next?.query ? current : next)
    if (next?.query !== query?.query) setActive(0)
  }
  const accept = (title: string): void => {
    const element = field.current
    if (!element || !query) return
    const next = completeWikilink(element.value, element.selectionStart, query.start, title)
    onValueChange(next.text)
    setQuery(null)
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(next.caret, next.caret) })
  }
  return <div className="wikilink-field">
    <textarea ref={field} {...rest} value={value} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      onChange={(event) => { onValueChange(event.target.value); track(event.target) }}
      onSelect={(event) => track(event.currentTarget)}
      onBlur={() => setQuery(null)}
      onKeyDown={(event) => {
        if (!open) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
        } else if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          accept(suggestions[active].title)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setQuery(null)
        }
      }}/>
    {open && <ul id={listId} role="listbox" className="wikilink-suggestions" aria-label="Link to">
      {suggestions.map((item, index) => <li key={`${item.kind}:${item.title}`} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        className={index === active ? 'active' : ''} onMouseDown={(event) => { event.preventDefault(); accept(item.title) }}>
        <strong>{item.title}</strong><small>{item.kind}</small>
      </li>)}
    </ul>}
  </div>
}
