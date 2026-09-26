import type { KeyboardEvent } from 'react'
import type { TabKind } from './resource-routing'

export interface Presentation { id: string; title: string }

/** Ways to view each kind of resource. The first is the default. */
export const presentations: Partial<Record<TabKind, readonly Presentation[]>> = {
  entity: [{ id: 'profile', title: 'Profile' }, { id: 'timeline', title: 'Timeline' }, { id: 'connections', title: 'Connections' }],
  document: [{ id: 'text', title: 'Text' }, { id: 'knowledge', title: 'Knowledge from it' }]
}

/** The requested presentation if the kind offers it, otherwise the kind's default. */
export function presentationFor(kind: TabKind, requested: string | undefined): string | undefined {
  const options = presentations[kind]
  return options?.some((option) => option.id === requested) ? requested : options?.[0].id
}

export function PresentationSwitcher({ kind, active, onChange }: { kind: TabKind; active: string; onChange(id: string): void }) {
  const options = presentations[kind] ?? []
  // Tab-list keyboard pattern: one tab stop, arrow keys (and Home/End) move between views.
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = options.findIndex((option) => option.id === active)
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null
    if (next === null || !options.length) return
    event.preventDefault()
    const list = event.currentTarget
    const target = options[(next + options.length) % options.length]
    onChange(target.id)
    requestAnimationFrame(() => list.querySelector<HTMLButtonElement>(`[data-presentation="${target.id}"]`)?.focus())
  }
  return <div className="presentation-switcher" role="tablist" aria-label="View as" onKeyDown={move}>
    {options.map((option) => <button key={option.id} role="tab" data-presentation={option.id} aria-selected={option.id === active} tabIndex={option.id === active ? 0 : -1}
      className={option.id === active ? 'active' : ''} onClick={() => { if (option.id !== active) onChange(option.id) }}>{option.title}</button>)}
  </div>
}
