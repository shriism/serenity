import type { TabKind } from './resource-routing'

export interface Presentation { id: string; title: string }

/** Ways to view each kind of resource. The first is the default. */
export const presentations: Partial<Record<TabKind, readonly Presentation[]>> = {
  entity: [{ id: 'profile', title: 'Profile' }, { id: 'timeline', title: 'Timeline' }, { id: 'connections', title: 'Connections' }]
}

/** The requested presentation if the kind offers it, otherwise the kind's default. */
export function presentationFor(kind: TabKind, requested: string | undefined): string | undefined {
  const options = presentations[kind]
  return options?.some((option) => option.id === requested) ? requested : options?.[0].id
}

export function PresentationSwitcher({ kind, active, onChange }: { kind: TabKind; active: string; onChange(id: string): void }) {
  const options = presentations[kind] ?? []
  return <div className="presentation-switcher" role="tablist" aria-label="View as">
    {options.map((option) => <button key={option.id} role="tab" aria-selected={option.id === active} className={option.id === active ? 'active' : ''}
      onClick={() => { if (option.id !== active) onChange(option.id) }}>{option.title}</button>)}
  </div>
}
