import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, CalendarDays, FileText, Link2, ListTodo, Search, Sparkles, X } from 'lucide-react'
import type { Provider, SearchResult } from '../../shared/types'

interface Props {
  open: boolean
  query: string
  results: SearchResult[] | null
  searching: boolean
  provider: Provider
  savedIndexEnabled: boolean
  onChange(value: string): void
  onClose(): void
  onSelect(result: SearchResult): void
  onAISearch(): void
  onSavedSearch(): void
}

const icons = { entity: Link2, claim: Link2, document: FileText, task: ListTodo, event: CalendarDays }

export function CommandPalette(props: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => { if (props.open) { setActive(0); input.current?.focus() } }, [props.open])
  useEffect(() => setActive(0), [props.results])
  if (!props.open) return null

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') { props.onClose(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => Math.min(Math.max(0, (props.results?.length ?? 1) - 1), current + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(0, current - 1)) }
    if (event.key === 'Enter' && props.results?.[active]) { event.preventDefault(); props.onSelect(props.results[active]) }
  }

  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="Search workspace">
      <div className="palette-input"><Search size={20}/><input ref={input} value={props.query} onChange={(event) => props.onChange(event.target.value)} onKeyDown={onKeyDown} placeholder="Search your world..." aria-label="Search workspace"/><button onClick={props.onClose} aria-label="Close search"><X size={17}/></button></div>
      <div className="palette-body">
        {props.query.trim() && <div className="palette-actions">
          <button onClick={props.onAISearch} disabled={props.searching}><Sparkles size={16}/>{props.searching ? 'Finding connections…' : `Search meaning with ${props.provider}`}<ArrowRight size={15}/></button>
          {props.savedIndexEnabled && <button onClick={props.onSavedSearch}><Link2 size={16}/>Search saved concepts offline<ArrowRight size={15}/></button>}
        </div>}
        {props.query.trim() && <div className="palette-group-label">{props.results?.length ? `RESULTS · ${props.results.length}` : 'RESULTS'}</div>}
        {props.results?.length ? <div className="palette-results">{props.results.map((result, index) => {
          const Icon = icons[result.kind]
          return <button key={`${result.kind}-${result.id}-${index}`} className={index === active ? 'active' : ''} onMouseEnter={() => setActive(index)} onClick={() => props.onSelect(result)}>
            <span className="palette-result-icon"><Icon size={17}/></span><span><strong>{result.title}</strong><small>{result.detail}</small></span><ArrowRight size={15}/>
          </button>
        })}</div> : props.query.trim() ? <div className="palette-empty">No local matches yet. Try a different phrase or search meaning with AI.</div> : <div className="palette-empty"><Sparkles size={23}/><strong>Everything, connected.</strong><span>Find people, ideas, documents, tasks, and events from one place.</span></div>}
      </div>
      <div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>esc</kbd> Close</span></div>
    </div>
  </div>
}
