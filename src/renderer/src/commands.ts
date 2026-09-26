import { Activity, CalendarDays, FileText, Files, FolderOpen, House, Inbox, Link2, ListTodo, MessageCircle, PanelLeft, PanelRight, Plus, RotateCw, Search, Settings2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'
import type { ModuleId } from '../../shared/modules'
import { resourceUri } from '../../shared/resources'
import type { View } from './views'

/** Operations the workbench shell exposes to commands. Persistent changes still go through validated IPC. */
export interface CommandHost {
  navigate(view: View): boolean
  openResource(uri: string): boolean
  newEntity(): void
  createPage(): void
  importDocuments(): void
  newConversation(): void
  toggleSearch(): void
  toggleNavigation(): void
  toggleAssistant(): void
  refresh(): void
}

export interface CommandContribution {
  id: string
  title: string
  icon: LucideIcon
  view?: View
  group?: 'Workspace' | 'Organize' | 'More'
  module?: ModuleId
  /** Default chord, e.g. `Mod+K`; a workspace keymap can replace or remove it. */
  keybinding?: string
  /** Whether the chord also fires while typing in a text field. */
  whileTyping?: boolean
  /** Hidden from the command palette, e.g. because the palette itself is how it is reached. */
  hideInPalette?: boolean
  run(host: CommandHost): void
}

const view = (id: View, title: string, icon: LucideIcon, group: CommandContribution['group'], module?: ModuleId): CommandContribution =>
  ({ id: `view.${id}`, title, icon, view: id, group, module, run: (host) => { host.navigate(id) } })

const builtins: CommandContribution[] = [
  view('home', 'Home', House, 'Workspace'),
  view('knowledge', 'Knowledge', Link2, 'Workspace'),
  view('review', 'Review', Inbox, 'Workspace'),
  view('documents', 'Documents', Files, 'Organize'),
  view('calendar', 'Calendar', CalendarDays, 'Organize', 'calendar'),
  view('tasks', 'Tasks', ListTodo, 'Organize', 'tasks'),
  view('activity', 'Activity', Activity, 'More'),
  view('settings', 'Settings', Settings2, 'More'),
  { id: 'entity.create', title: 'New entity', icon: Plus, run: (host) => host.newEntity() },
  { id: 'page.create', title: 'New page', icon: FileText, run: (host) => host.createPage() },
  { id: 'documents.import', title: 'Import documents', icon: FolderOpen, run: (host) => host.importDocuments() },
  { id: 'assistant.new', title: 'New conversation', icon: MessageCircle, run: (host) => host.newConversation() },
  { id: 'assistant.toggle', title: 'Toggle assistant', icon: PanelRight, keybinding: 'Mod+J', run: (host) => host.toggleAssistant() },
  { id: 'navigation.toggle', title: 'Toggle navigation', icon: PanelLeft, keybinding: 'Mod+B', run: (host) => host.toggleNavigation() },
  { id: 'workspace.search', title: 'Search workspace', icon: Search, keybinding: 'Mod+K', whileTyping: true, hideInPalette: true, run: (host) => host.toggleSearch() },
  { id: 'workspace.refresh', title: 'Refresh files', icon: RotateCw, run: (host) => host.refresh() }
]

/** Every command ID this workspace could bind, including commands whose module is currently disabled. */
export function knownCommandIds(workspace: WorkspaceSnapshot, contributions: readonly CommandContribution[] = []): Set<string> {
  return new Set([...builtins, ...contributions].map((command) => command.id).concat(workspace.pages.map((page) => `page.open.${page.id}`)))
}

export function workspaceCommands(workspace: WorkspaceSnapshot, contributions: readonly CommandContribution[] = []): CommandContribution[] {
  const pages: CommandContribution[] = workspace.pages.map((page) => ({ id: `page.open.${page.id}`, title: page.title, icon: FileText,
    run: (host) => { host.openResource(resourceUri({ kind: 'page', id: page.id })) } }))
  const commands = new Map<string, CommandContribution>([...builtins, ...pages, ...contributions].map((command) => [command.id, command]))
  return [...commands.values()].filter((command) => !command.module || workspace.modules[command.module])
}
