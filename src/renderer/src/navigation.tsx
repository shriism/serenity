import type { CommandContribution } from './commands'
import type { WorkbenchConfig } from '../../shared/types'
import type { View } from './views'

interface Props {
  view: View
  activePageId: string | null
  pendingCount: number
  commands: CommandContribution[]
  navigation: WorkbenchConfig['navigation']
  onCommand(id: string): void
}

export function AppNavigation({ view, activePageId, pendingCount, commands, navigation, onCommand }: Props) {
  return <nav className="navigation" aria-label="Main navigation">
    {navigation.map(({ group, commands: ids }, index) => <div className="navigation-group" key={group}>
      <span className={`nav-heading ${index > 0 ? 'spaced' : ''}`}>{group}</span>
      {ids.flatMap((id) => commands.filter((command) => command.id === id)).map(({ id, title, icon: Icon, view: destination }) => {
        const active = id.startsWith('page.open.') ? view === 'home' && activePageId === id.slice('page.open.'.length) :
          view === destination && (id !== 'view.home' || activePageId === null)
        return <button key={id} className={active ? 'active' : ''} onClick={() => onCommand(id)} title={title} aria-label={title} aria-current={active ? 'page' : undefined}>
        <Icon size={18} strokeWidth={1.9}/><span>{title}</span>{id === 'view.review' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
      </button> })}
    </div>)}
  </nav>
}
