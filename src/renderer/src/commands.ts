import { Activity, CalendarDays, FileText, Files, FolderOpen, House, Inbox, Link2, ListTodo, MessageCircle, Plus, RotateCw, Search, Settings2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import type { ModuleId } from '../../shared/modules'
import type { View } from './views'

export interface CommandContribution {
  id: string
  title: string
  icon: LucideIcon
  view?: View
  group?: 'Workspace' | 'Organize' | 'More'
  module?: ModuleId
}

const builtins: CommandContribution[] = [
  { id: 'view.home', title: 'Home', icon: House, view: 'home', group: 'Workspace' },
  { id: 'view.knowledge', title: 'Knowledge', icon: Link2, view: 'knowledge', group: 'Workspace' },
  { id: 'view.review', title: 'Review', icon: Inbox, view: 'review', group: 'Workspace' },
  { id: 'view.documents', title: 'Documents', icon: Files, view: 'documents', group: 'Organize' },
  { id: 'view.calendar', title: 'Calendar', icon: CalendarDays, view: 'calendar', group: 'Organize', module: 'calendar' },
  { id: 'view.tasks', title: 'Tasks', icon: ListTodo, view: 'tasks', group: 'Organize', module: 'tasks' },
  { id: 'view.activity', title: 'Activity', icon: Activity, view: 'activity', group: 'More' },
  { id: 'view.settings', title: 'Settings', icon: Settings2, view: 'settings', group: 'More' },
  { id: 'entity.create', title: 'New entity', icon: Plus },
  { id: 'page.create', title: 'New page', icon: FileText },
  { id: 'documents.import', title: 'Import documents', icon: FolderOpen },
  { id: 'assistant.new', title: 'New conversation', icon: MessageCircle },
  { id: 'workspace.search', title: 'Search workspace', icon: Search },
  { id: 'workspace.refresh', title: 'Refresh files', icon: RotateCw }
]

export function workspaceCommands(workspace: WorkspaceSnapshot, contributions: readonly CommandContribution[] = []): CommandContribution[] {
  const pages: CommandContribution[] = workspace.pages.map((page) => ({ id: `page.open.${page.id}`, title: page.title, icon: FileText }))
  const commands = new Map<string, CommandContribution>([...builtins, ...pages, ...contributions].map((command) => [command.id, command]))
  return [...commands.values()].filter((command) => !command.module || workspace.modules[command.module])
}
