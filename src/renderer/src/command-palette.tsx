import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, CalendarDays, FileText, Link2, ListTodo, Search, Sparkles, X } from 'lucide-react'
import type { Provider, SearchResult } from '../../shared/types'
import type { CommandContribution } from './commands'

interface Props {
  open: boolean
  query: string
  results: SearchResult[] | null
  searching: boolean
  provider: Provider
  savedIndexEnabled: boolean
  commands: CommandContribution[]
  onChange(value: string): void
  onClose(): void
  onSelect(result: SearchResult, side: boolean): void
  onAISearch(): void
  onSavedSearch(): void
  onCommand(id: string): void
  shortcutFor(id: string): string | undefined
}

const icons = { entity: Link2, claim: Link2, document: FileText, task: ListTodo, event: CalendarDays, page: FileText }

export function CommandPalette(props: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => { if (props.open) { setActive(0); input.current?.focus() } }, [props.open])
  useEffect(() => setActive(0), [props.results, props.query])
  if (!props.open) return null

  const commandMatches = props.commands.filter((command) =>
    command.title.toLowerCase().includes(props.query.trim().toLowerCase())).slice(0, props.query.trim() ? 6 : 8)
  const entries = [
    ...commandMatches.map((command) => ({ type: 'command' as const, command })),
    ...(props.results ?? []).map((result) => ({ type: 'result' as const, result }))
  ]

  function choose(index: number, side = false): void {
    const entry = entries[index]
    if (!entry) return
    if (entry.type === 'command') { props.onClose(); props.onCommand(entry.command.id) }
    else props.onSelect(entry.result, side)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') { props.onClose(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => Math.min(Math.max(0, entries.length - 1), current + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(0, current - 1)) }
    if (event.key === 'Enter' && entries[active]) { event.preventDefault(); choose(active, event.metaKey || event.ctrlKey) }
  }

  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="Search workspace">
      <div className="palette-input"><Search size={20}/><input ref={input} value={props.query} onChange={(event) => props.onChange(event.target.value)} onKeyDown={onKeyDown} placeholder="Search your world..." aria-label="Search workspace"/><button onClick={props.onClose} aria-label="Close search"><X size={17}/></button></div>
      <div className="palette-body">
        {props.query.trim() && <div className="palette-actions">
          <button onClick={props.onAISearch} disabled={props.searching}><Sparkles size={16}/>{props.searching ? 'Finding connections…' : `Search meaning with ${props.provider}`}<ArrowRight size={15}/></button>
          {props.savedIndexEnabled && <button onClick={props.onSavedSearch}><Link2 size={16}/>Search saved concepts offline<ArrowRight size={15}/></button>}
        </div>}
        {entries.length > 0 ? <div className="palette-results">{entries.map((entry, index) => {
          const Icon = entry.type === 'command' ? entry.command.icon : icons[entry.result.kind]
          const title = entry.type === 'command' ? entry.command.title : entry.result.title
          const detail = entry.type === 'command' ? ['Command', props.shortcutFor(entry.command.id)].filter(Boolean).join(' · ') : entry.result.detail
          return <button key={entry.type === 'command' ? entry.command.id : `${entry.result.kind}-${entry.result.id}-${index}`}
            className={index === active ? 'active' : ''} onMouseEnter={() => setActive(index)} onClick={(event) => choose(index, event.metaKey || event.ctrlKey)}>
            <span className="palette-result-icon"><Icon size={17}/></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight size={15}/>
          </button>
        })}</div> : <div className="palette-empty">No local matches yet. Try another phrase or search meaning with AI.</div>}
      </div>
      <div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd><kbd>↵</kbd> Open to the side</span><span><kbd>esc</kbd> Close</span></div>
    </div>
  </div>
}
