import { Activity, CalendarDays, Files, House, Inbox, Link2, ListTodo, Settings2 } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import type { View } from './views'

interface Props {
  workspace: WorkspaceSnapshot
  view: View
  pendingCount: number
  onNavigate(view: View): void
}

export function AppNavigation({ workspace, view, pendingCount, onNavigate }: Props) {
  const main = [
    { id: 'home' as const, label: 'Home', icon: House },
    { id: 'knowledge' as const, label: 'Knowledge', icon: Link2 },
    { id: 'review' as const, label: 'Review', icon: Inbox, count: pendingCount }
  ]
  const organize = [
    { id: 'documents' as const, label: 'Documents', icon: Files, visible: true },
    { id: 'calendar' as const, label: 'Calendar', icon: CalendarDays, visible: workspace.modules.calendar },
    { id: 'tasks' as const, label: 'Tasks', icon: ListTodo, visible: workspace.modules.tasks }
  ].filter((item) => item.visible)

  return <nav className="navigation" aria-label="Main navigation">
    <span className="nav-heading">Workspace</span>
    {main.map(({ id, label, icon: Icon, ...rest }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => onNavigate(id)} title={label} aria-label={label} aria-current={view === id ? 'page' : undefined}>
      <Icon size={18} strokeWidth={1.9}/><span>{label}</span>{typeof rest.count === 'number' && rest.count > 0 && <span className="nav-count">{rest.count}</span>}
    </button>)}
    <span className="nav-heading spaced">Organize</span>
    {organize.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => onNavigate(id)} title={label} aria-label={label} aria-current={view === id ? 'page' : undefined}>
      <Icon size={18} strokeWidth={1.9}/><span>{label}</span>
    </button>)}
    <span className="nav-heading spaced">More</span>
    <button className={view === 'activity' ? 'active' : ''} onClick={() => onNavigate('activity')} title="Activity" aria-label="Activity" aria-current={view === 'activity' ? 'page' : undefined}><Activity size={18} strokeWidth={1.9}/><span>Activity</span></button>
    <button className={view === 'settings' ? 'active' : ''} onClick={() => onNavigate('settings')} title="Settings" aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined}><Settings2 size={18} strokeWidth={1.9}/><span>Settings</span></button>
  </nav>
}
