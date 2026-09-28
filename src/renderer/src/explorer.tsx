import { memo, useMemo, useState, type MouseEvent } from 'react'
import { Archive, ChevronRight, Columns2, Copy, ExternalLink, FilePlus2, FileText, FileUp, Search, UserPlus, X } from 'lucide-react'
import { useContextMenu } from './menu'
import type { WorkspaceSnapshot } from '../../shared/types'
import { parseResourceUri, resourceUri } from '../../shared/resources'
import { entityTypes } from '../../shared/library'

// A folder shows this many items at first; a larger one offers the rest on request rather than drawing thousands.
const folderLimit = 200

function stored(key: string): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean> } catch { return {} }
}

const normalized = (text: string): string => text.normalize('NFKD').toLocaleLowerCase()

interface Item { uri: string; title: string; detail?: string }
interface Folder { id: string; title: string; items: Item[] }

/**
 * The workspace as a tree: pages, entities grouped by their type, and imported documents. Clicking an item opens it in
 * the focused pane; ⌘/Ctrl-click opens it in the next one.
 */
export const Explorer = memo(function Explorer({ workspace, activeUri, onOpen, onNewPage, onNewEntity, onImport, onArchive }: {
  workspace: WorkspaceSnapshot
  /** The resource shown in the focused pane, highlighted in the tree. */
  activeUri?: string
  onOpen(uri: string, side: boolean): void
  onNewPage(): void
  onNewEntity(): void
  onImport(): void
  /** Moves a page, entity, or document to the workspace archive, after asking. */
  onArchive(uri: string): void
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => stored('serenity.explorer-collapsed'))
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [filtering, setFiltering] = useState(false)
  const contextMenu = useContextMenu()

  const folders = useMemo<Folder[]>(() => {
    const pages: Folder = { id: 'pages', title: 'Pages', items: [...workspace.pages]
      .sort((a, b) => Number(b.id === workspace.workbench.homePage) - Number(a.id === workspace.workbench.homePage) || a.title.localeCompare(b.title))
      .map((page) => ({ uri: resourceUri({ kind: 'page', id: page.id }), title: page.title })) }
    const byType = new Map<string, Item[]>()
    for (const entity of workspace.entities) {
      const type = entity.type.trim() || 'Untyped'
      byType.set(type, [...(byType.get(type) ?? []), { uri: resourceUri({ kind: 'entity', id: entity.id }), title: entity.title || 'Untitled' }])
    }
    const types = entityTypes(workspace.entities).map(({ type }) => type.trim() || 'Untyped')
    const entityFolders: Folder[] = [...new Set(types)].map((type) => ({ id: `type:${type}`, title: type,
      items: (byType.get(type) ?? []).sort((a, b) => a.title.localeCompare(b.title)) }))
    const documents: Folder = { id: 'documents', title: 'Documents', items: workspace.documents.map((document) =>
      ({ uri: resourceUri({ kind: 'document', id: document.name }), title: document.name, detail: document.extractable ? undefined : 'Opens in its app' })) }
    return [pages, ...entityFolders, documents]
  }, [workspace.pages, workspace.entities, workspace.documents, workspace.workbench.homePage])

  const wanted = normalized(filter.trim())
  const shown = wanted ? folders.map((folder) => ({ ...folder, items: folder.items.filter((item) => normalized(item.title).includes(wanted)) }))
    .filter((folder) => folder.items.length) : folders

  function toggle(id: string): void {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] }
      try { localStorage.setItem('serenity.explorer-collapsed', JSON.stringify(next)) } catch { /* Still works for this session. */ }
      return next
    })
  }

  const open = (uri: string) => (event: MouseEvent) => onOpen(uri, event.metaKey || event.ctrlKey)
  const archivable = (uri: string) => {
    const ref = parseResourceUri(uri)
    return ref && !(ref.kind === 'page' && ref.id === workspace.workbench.homePage)
      ? [{ id: 'archive', label: 'Move to archive…', icon: <Archive size={14}/>, danger: true, separated: true, run: () => onArchive(uri) }] : []
  }
  const entityFolders = shown.filter((folder) => folder.id.startsWith('type:'))
  const renderFolder = (folder: Folder, depth: number) => {
    const closed = !wanted && (collapsed[folder.id] ?? (folder.id.startsWith('type:') && folder.items.length > 60))
    const limit = expanded[folder.id] ? Infinity : folderLimit
    const name = `${folder.title}, ${folder.items.length} ${folder.items.length === 1 ? 'item' : 'items'}`
    return <li key={folder.id} className="tree-folder" role="treeitem" aria-expanded={!closed} aria-level={depth} aria-selected={false} aria-label={name}>
      <button type="button" className="tree-row folder" style={{ paddingLeft: 8 + (depth - 1) * 12 }} onClick={() => toggle(folder.id)} aria-label={name}>
        <ChevronRight size={13} className="tree-chevron"/><span className="tree-label">{folder.title}</span><span className="tree-count">{folder.items.length}</span>
      </button>
      {!closed && <ul role="group">
        {folder.items.slice(0, limit).map((item) => <li key={item.uri} role="treeitem" aria-level={depth + 1} aria-selected={item.uri === activeUri} aria-label={item.title}>
          <button type="button" className={`tree-row ${item.uri === activeUri ? 'active' : ''}`} style={{ paddingLeft: 22 + (depth - 1) * 12 }}
            onClick={open(item.uri)} title={item.detail ? `${item.title} · ${item.detail}` : item.title}
            onContextMenu={(event) => contextMenu.open(event, `${item.title} actions`, [
              { id: 'open', label: item.detail ? 'Open in its app' : 'Open', icon: item.detail ? <ExternalLink size={14}/> : <FileText size={14}/>, run: () => onOpen(item.uri, false) },
              ...(item.detail ? [] : [{ id: 'side', label: 'Open in next pane', icon: <Columns2 size={14}/>, detail: '⌘-click', run: () => onOpen(item.uri, true) }]),
              { id: 'link', label: 'Copy link', icon: <Copy size={14}/>, detail: `[[${item.title}]]`.length > 24 ? undefined : `[[${item.title}]]`, separated: true, run: () => window.serenity.copyText(`[[${item.title}]]`) },
              ...archivable(item.uri)
            ])}>
            <span className="tree-label">{item.title}</span>
          </button>
        </li>)}
        {folder.items.length > limit && <li role="none"><button type="button" className="tree-row more" style={{ paddingLeft: 22 + (depth - 1) * 12 }}
          onClick={() => setExpanded((current) => ({ ...current, [folder.id]: true }))}>Show {folder.items.length - limit} more</button></li>}
        {!folder.items.length && <li role="none" className="tree-empty" style={{ paddingLeft: 22 + (depth - 1) * 12 }}>
          {folder.id === 'documents' ? <button type="button" className="text-button" onClick={onImport}>Import documents…</button> :
            folder.id === 'pages' ? <button type="button" className="text-button" onClick={onNewPage}>New page</button> : 'Empty'}</li>}
      </ul>}
    </li>
  }

  return <nav className="explorer" aria-label="Files">
    <div className="sidebar-toolbar">
      <span className="sidebar-title">Files</span>
      <div className="sidebar-actions">
        <button type="button" className="icon-btn" onClick={onNewPage} aria-label="New page" title="New page"><FilePlus2 size={15}/></button>
        <button type="button" className="icon-btn" onClick={onNewEntity} aria-label="New entity" title="New entity"><UserPlus size={15}/></button>
        <button type="button" className="icon-btn" onClick={onImport} aria-label="Import documents" title="Import documents"><FileUp size={15}/></button>
        <button type="button" className={`icon-btn ${filtering ? 'pressed' : ''}`} onClick={() => { setFiltering((value) => !value); setFilter('') }}
          aria-label="Filter files" title="Filter files" aria-pressed={filtering}><Search size={15}/></button>
      </div>
    </div>
    {filtering && <div className="sidebar-filter"><input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by name"
      aria-label="Filter files by name" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setFiltering(false); setFilter('') } }}/>
      {filter && <button type="button" className="icon-btn" onClick={() => setFilter('')} aria-label="Clear filter"><X size={13}/></button>}</div>}
    {contextMenu.element}
    <div className="tree-scroll">
      <ul className="tree" role="tree" aria-label="Workspace files">
        {shown.filter((folder) => folder.id === 'pages').map((folder) => renderFolder(folder, 1))}
        {(entityFolders.length > 0 || !wanted) && <li className="tree-folder" role="treeitem" aria-expanded={!collapsed.knowledge || Boolean(wanted)} aria-level={1} aria-selected={false}
          aria-label={`Knowledge, ${workspace.entities.length} entities`}>
          <button type="button" className="tree-row folder" style={{ paddingLeft: 8 }} onClick={() => toggle('knowledge')} aria-label={`Knowledge, ${workspace.entities.length} entities`}>
            <ChevronRight size={13} className="tree-chevron"/><span className="tree-label">Knowledge</span><span className="tree-count">{workspace.entities.length}</span>
          </button>
          {(!collapsed.knowledge || wanted) && <ul role="group">
            {entityFolders.map((folder) => renderFolder(folder, 2))}
            {!entityFolders.length && <li role="none" className="tree-empty" style={{ paddingLeft: 22 }}>
              <button type="button" className="text-button" onClick={onNewEntity}>New entity</button></li>}
          </ul>}
        </li>}
        {shown.filter((folder) => folder.id === 'documents').map((folder) => renderFolder(folder, 1))}
        {wanted && !shown.length && <li role="none" className="tree-empty" style={{ paddingLeft: 12 }}><FileText size={13}/> Nothing matches “{filter.trim()}”</li>}
      </ul>
    </div>
  </nav>
})
