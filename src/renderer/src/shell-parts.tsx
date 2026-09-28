import { useMemo, useState, type FormEvent } from 'react'
import { FolderOpen, LayoutPanelLeft, MessageSquare, Settings2, X } from 'lucide-react'
import type { WorkbenchConfig, WorkspaceSnapshot } from '../../shared/types'
import { identityCandidates } from '../../shared/identity'
import type { CommandContribution } from './commands'
import { Dialog } from './dialog'
import type { View } from './views'

const serenityIcon = new URL('../../../assets/icon.svg', import.meta.url).href

/**
 * The narrow strip of icons at the window's left edge, present in both modes so it never moves. At the top it switches
 * between Workspace and Chat; below come the views, whose order comes from the workspace's `.serenity/workbench.yaml`
 * navigation; Settings sits at the bottom, as in other desktop workbenches.
 */
export function Ribbon({ commands, navigation, activeView, homeShown, pendingCount, mode, onMode, modeShortcut, shortcutFor, onCommand }: {
  commands: CommandContribution[]
  navigation: WorkbenchConfig['navigation']
  activeView: View | null
  /** Whether the focused tab is the Home page, which lights up the Home icon. */
  homeShown: boolean
  pendingCount: number
  mode: 'workspace' | 'chat'
  onMode(mode: 'workspace' | 'chat'): void
  modeShortcut?: string
  shortcutFor(id: string): string | undefined
  onCommand(id: string): void
}) {
  const ids = navigation.flatMap(({ commands: list }) => list)
  const entries = ids.flatMap((id) => commands.filter((command) => command.id === id && command.id !== 'view.settings'))
  const settings = commands.find((command) => command.id === 'view.settings')
  const label = (command: CommandContribution): string => { const keys = shortcutFor(command.id); return keys ? `${command.title} (${keys})` : command.title }
  const switchTitle = (name: string, detail: string): string => `${name}: ${detail}${modeShortcut ? ` (${modeShortcut} to switch)` : ''}`
  return <nav className="ribbon" aria-label="Views">
    <div className="ribbon-group ribbon-mode" role="radiogroup" aria-label="Mode">
      <button type="button" role="radio" aria-checked={mode === 'workspace'} className={`ribbon-btn mode ${mode === 'workspace' ? 'active' : ''}`} onClick={() => onMode('workspace')}
        aria-label="Workspace" title={switchTitle('Workspace', 'your files, views, and panes')}><LayoutPanelLeft size={18} strokeWidth={1.75}/></button>
      <button type="button" role="radio" aria-checked={mode === 'chat'} className={`ribbon-btn mode ${mode === 'chat' ? 'active' : ''}`} onClick={() => onMode('chat')}
        aria-label="Chat" title={switchTitle('Chat', 'a full-window conversation')}><MessageSquare size={18} strokeWidth={1.75}/></button>
    </div>
    <div className="ribbon-separator" role="separator"/>
    <div className="ribbon-group">
      {entries.map((command) => {
        const Icon = command.icon
        const active = mode === 'workspace' && (command.view === 'home' ? homeShown : command.view !== undefined && command.view === activeView)
        return <button key={command.id} type="button" className={`ribbon-btn ${active ? 'active' : ''}`} onClick={() => onCommand(command.id)}
          aria-label={command.id === 'view.review' && pendingCount ? `${command.title}, ${pendingCount} waiting` : command.title} title={label(command)} aria-current={active ? 'page' : undefined}>
          <Icon size={18} strokeWidth={1.75}/>{command.id === 'view.review' && pendingCount > 0 && <span className="ribbon-badge" aria-hidden="true">{pendingCount > 99 ? '99+' : pendingCount}</span>}
        </button>
      })}
    </div>
    {settings && <div className="ribbon-group bottom">
      <button type="button" className="ribbon-btn" onClick={() => onCommand(settings.id)} aria-label="Settings" title={label(settings)}><Settings2 size={18} strokeWidth={1.75}/></button>
    </div>}
  </nav>
}

/** An empty pane: quick ways to fill it, in the spirit of a browser's new tab. */
export function NewTabScreen({ actions }: { actions: { id: string; label: string; keys?: string; run(): void }[] }) {
  return <div className="new-tab-screen">
    <div className="new-tab-actions">
      {actions.map((action) => <button key={action.id} type="button" onClick={action.run}>
        <span>{action.label}</span>{action.keys && <kbd>{action.keys}</kbd>}
      </button>)}
    </div>
  </div>
}

/** Names a new entity and creates it straight away, pointing out existing entities it might duplicate. */
export function NewEntityDialog({ workspace, onCreate, onOpen, onClose }: {
  workspace: WorkspaceSnapshot
  onCreate(title: string, type: string): Promise<boolean>
  onOpen(id: string): void
  onClose(): void
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('')
  const [busy, setBusy] = useState(false)
  const candidates = useMemo(() => title.trim().length > 1 ? identityCandidates(title, type, workspace.entities).slice(0, 4) : [], [title, type, workspace.entities])
  const types = useMemo(() => [...new Set(workspace.entities.map((entity) => entity.type).filter(Boolean))].sort(), [workspace.entities])
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!title.trim() || !type.trim() || busy) return
    setBusy(true)
    if (await onCreate(title.trim(), type.trim())) onClose()
    else setBusy(false)
  }
  return <Dialog title="New entity" onClose={onClose} className="settings-small">
    <form className="stacked-form" onSubmit={(event) => void submit(event)}>
      <label className="field-label" htmlFor="new-entity-title">Name</label>
      <input id="new-entity-title" autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Who or what is it?"/>
      <label className="field-label" htmlFor="new-entity-type">Type, in your own words</label>
      <input id="new-entity-type" required list="entity-types" value={type} onChange={(event) => setType(event.target.value)} placeholder="Person, project, place, idea…"/>
      <datalist id="entity-types">{types.map((item) => <option key={item} value={item}/>)}</datalist>
      {candidates.length > 0 && <div className="callout">
        <strong>Could this already exist?</strong>
        <p>Similar names don’t prove they’re the same. Open one to check.</p>
        <ul className="candidate-list">{candidates.map(({ entity }) => <li key={entity.id}><button type="button" className="text-button" onClick={() => { onOpen(entity.id); onClose() }}>
          {entity.title}<small>{entity.type}</small></button></li>)}</ul>
      </div>}
      <div className="form-buttons"><button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !title.trim() || !type.trim()}>Create</button></div>
    </form>
  </Dialog>
}

export interface RecentWorkspace { path: string; name: string; available: boolean }

/** Shown before a workspace is open: offers the last one used, other recent ones, and any other folder. */
export function Welcome({ recent, onChoose, onOpenRecent, onForget }: {
  recent: RecentWorkspace[] | null
  onChoose(): void
  onOpenRecent(path: string): void
  onForget(path: string): void
}) {
  const last = recent?.find((item) => item.available)
  const others = recent?.filter((item) => item !== last) ?? []
  return <div className="welcome">
    <div className="welcome-card">
      <img src={serenityIcon} alt="" className="welcome-icon"/>
      <h1>{last ? 'Welcome back' : 'Serenity'}</h1>
      <p>{last ? 'Pick up where you left off, or open another workspace.' :
        'A private workspace for what you know, the people and projects in your life, and the plans in between, with AI that suggests and never overwrites.'}</p>
      {recent === null ? null : last ? <>
        <button type="button" className="primary large" onClick={() => onOpenRecent(last.path)} autoFocus>Open “{last.name}”</button>
        <small className="welcome-path" title={last.path}>{last.path}</small>
        <button type="button" className="secondary" onClick={onChoose}><FolderOpen size={15}/> Open another folder…</button>
      </> : <>
        <button type="button" className="primary large" onClick={onChoose} autoFocus><FolderOpen size={16}/> Open or create a workspace…</button>
        <small>Pick any folder. Your knowledge is stored there as Markdown and YAML files you own.</small>
      </>}
      {others.length > 0 && <section className="welcome-recent" aria-label="Recent workspaces">
        <h2>Recent</h2>
        <ul>{others.map((item) => <li key={item.path}>
          <button type="button" className="welcome-recent-open" disabled={!item.available} onClick={() => onOpenRecent(item.path)} title={item.path}>
            <strong>{item.name}</strong><small>{item.available ? item.path : 'Not found — moved, renamed, or on a disconnected drive'}</small>
          </button>
          <button type="button" className="icon-btn" onClick={() => onForget(item.path)} aria-label={`Remove ${item.name} from recent workspaces`} title="Remove from list"><X size={14}/></button>
        </li>)}</ul>
      </section>}
    </div>
  </div>
}
