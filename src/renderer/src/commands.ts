import { X, Layers, Monitor, Moon, Sun, Activity, ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowRightLeft, ArrowUp, CalendarDays, Columns2, Rows2, SquareX, MoveRight, FileText, Files, FolderOpen, House, Inbox, Link2, ListTodo, Maximize2, MessageCircle, PanelLeft, PanelRight, Plus, RotateCw, Search, Settings2 } from 'lucide-react'
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
  chooseWorkspace(): void
  openWorkspaceFolder(): void
  newConversation(): void
  toggleSearch(): void
  toggleNavigation(): void
  splitEditor(direction: 'row' | 'column'): void
  closeEditorGroup(): void
  /** `step` 1 focuses the next pane in reading order, -1 the previous one. */
  focusNextGroup(step: number): void
  focusPane(direction: 'left' | 'right' | 'up' | 'down'): void
  moveTabToOtherGroup(): void
  toggleAssistant(): void
  toggleAssistantExpansion(): void
  setAppearance(theme: 'dark' | 'light' | 'system'): void
  /** Shows the focused tab through its resource's next view, e.g. an entity's Timeline after its Profile. */
  cyclePresentation(): void
  /** Opens an empty tab in the focused pane. */
  newTab(): void
  closeTab(): void
  /** `step` 1 shows the next tab in the focused pane, -1 the previous one. */
  cycleTab(step: number): void
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
  { ...view('settings', 'Settings', Settings2, 'More'), keybinding: 'Mod+,' },
  { ...view('search', 'Search in a pane', Search, undefined), keybinding: 'Mod+Shift+F' },
  { id: 'entity.create', title: 'New entity', icon: Plus, run: (host) => host.newEntity() },
  { id: 'page.create', title: 'New page', icon: FileText, keybinding: 'Mod+N', run: (host) => host.createPage() },
  { id: 'documents.import', title: 'Import documents', icon: FolderOpen, run: (host) => host.importDocuments() },
  { id: 'workspace.choose', title: 'Open another workspace', icon: FolderOpen, keybinding: 'Mod+O', run: (host) => host.chooseWorkspace() },
  { id: 'workspace.open-folder', title: 'Open workspace folder', icon: FolderOpen, run: (host) => host.openWorkspaceFolder() },
  { id: 'assistant.new', title: 'New conversation', icon: MessageCircle, run: (host) => host.newConversation() },
  { id: 'assistant.toggle', title: 'Toggle assistant', icon: PanelRight, keybinding: 'Mod+J', run: (host) => host.toggleAssistant() },
  { id: 'assistant.expand', title: 'Switch between Workspace and Chat', icon: Maximize2, keybinding: 'Mod+Shift+J', run: (host) => host.toggleAssistantExpansion() },
  { id: 'navigation.toggle', title: 'Toggle sidebar', icon: PanelLeft, keybinding: 'Mod+B', run: (host) => host.toggleNavigation() },
  { id: 'layout.split', title: 'Split right', icon: Columns2, keybinding: 'Mod+\\', run: (host) => host.splitEditor('row') },
  { id: 'layout.split-down', title: 'Split down', icon: Rows2, keybinding: 'Mod+Shift+\\', run: (host) => host.splitEditor('column') },
  { id: 'layout.close-group', title: 'Close pane', icon: SquareX, run: (host) => host.closeEditorGroup() },
  { id: 'layout.focus-next', title: 'Focus next pane', icon: ArrowRightLeft, run: (host) => host.focusNextGroup(1) },
  { id: 'layout.focus-previous', title: 'Focus previous pane', icon: ArrowLeftRight, run: (host) => host.focusNextGroup(-1) },
  { id: 'layout.focus-left', title: 'Focus pane to the left', icon: ArrowLeft, keybinding: 'Mod+Alt+ArrowLeft', run: (host) => host.focusPane('left') },
  { id: 'layout.focus-right', title: 'Focus pane to the right', icon: ArrowRight, keybinding: 'Mod+Alt+ArrowRight', run: (host) => host.focusPane('right') },
  { id: 'layout.focus-up', title: 'Focus pane above', icon: ArrowUp, keybinding: 'Mod+Alt+ArrowUp', run: (host) => host.focusPane('up') },
  { id: 'layout.focus-down', title: 'Focus pane below', icon: ArrowDown, keybinding: 'Mod+Alt+ArrowDown', run: (host) => host.focusPane('down') },
  { id: 'layout.move-tab', title: 'Move tab to next pane', icon: MoveRight, run: (host) => host.moveTabToOtherGroup() },
  { id: 'tab.new', title: 'New tab', icon: Plus, keybinding: 'Mod+T', run: (host) => host.newTab() },
  { id: 'tab.close', title: 'Close tab', icon: X, keybinding: 'Mod+W', run: (host) => host.closeTab() },
  { id: 'tab.next', title: 'Next tab', icon: ArrowRight, keybinding: 'Mod+Shift+]', run: (host) => host.cycleTab(1) },
  { id: 'tab.previous', title: 'Previous tab', icon: ArrowLeft, keybinding: 'Mod+Shift+[', run: (host) => host.cycleTab(-1) },
  { id: 'workspace.search', title: 'Search workspace', icon: Search, keybinding: 'Mod+K', whileTyping: true, hideInPalette: true, run: (host) => host.toggleSearch() },
  { id: 'appearance.dark', title: 'Appearance: Dark', icon: Moon, run: (host) => host.setAppearance('dark') },
  { id: 'appearance.light', title: 'Appearance: Light', icon: Sun, run: (host) => host.setAppearance('light') },
  { id: 'appearance.system', title: 'Appearance: Match system', icon: Monitor, run: (host) => host.setAppearance('system') },
  { id: 'presentation.next', title: 'Switch view of this tab', icon: Layers, run: (host) => host.cyclePresentation() },
  { id: 'workspace.refresh', title: 'Refresh files', icon: RotateCw, run: (host) => host.refresh() }
]

/** One authority for command identity, module availability, discovery, and dispatch. */
export class CommandRegistry {
  private entries = new Map<string, CommandContribution>()

  constructor(private workspace: WorkspaceSnapshot, contributions: readonly CommandContribution[] = []) {
    for (const command of builtins) this.register(command)
    for (const page of workspace.pages) this.register({ id: `page.open.${page.id}`, title: page.title, icon: FileText,
      run: (host) => { host.openResource(resourceUri({ kind: 'page', id: page.id })) } })
    for (const command of contributions) this.register(command)
  }

  register(command: CommandContribution): void {
    if (!/^[a-z][a-z0-9.-]*$/.test(command.id) || !command.title.trim() || typeof command.run !== 'function')
      throw new Error(`Invalid command contribution: ${command.id}`)
    if (this.entries.has(command.id)) throw new Error(`Command already registered: ${command.id}`)
    this.entries.set(command.id, command)
  }

  /** Includes disabled-module commands so workspace keymaps retain their identity. */
  knownIds(): Set<string> { return new Set(this.entries.keys()) }

  get(id: string): CommandContribution | undefined {
    const command = this.entries.get(id)
    return command && (!command.module || this.workspace.modules[command.module]) ? command : undefined
  }

  list(): CommandContribution[] { return [...this.entries.keys()].flatMap((id) => this.get(id) ?? []) }

  dispatch(id: string, host: CommandHost): boolean {
    const command = this.get(id)
    if (!command) return false
    command.run(host)
    return true
  }
}
