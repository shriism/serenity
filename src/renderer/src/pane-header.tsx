import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, CalendarDays, Columns2, FileText, Files, Inbox, ListTodo, MoreHorizontal, Network, NotebookText, Plus, Rows2, Search, SquareX, X, CircleDot } from 'lucide-react'
import type { TabRef } from './resource-routing'
import { tabDragType } from './pane-layout'
import { MenuButton, type MenuItem } from './menu'

export interface PaneTab { key: string; tab: TabRef; title: string }

const viewIcons: Record<string, typeof FileText> = { knowledge: Network, review: Inbox, documents: Files, calendar: CalendarDays, tasks: ListTodo, activity: Activity, search: Search }
export function TabIcon({ tab, size = 14 }: { tab: TabRef; size?: number }) {
  const Icon = tab.kind === 'view' ? viewIcons[tab.id] ?? FileText : tab.kind === 'entity' ? CircleDot : tab.kind === 'page' ? NotebookText : FileText
  return <Icon size={size} aria-hidden="true"/>
}

/**
 * A pane's tab strip, with its own actions. The top row of panes sits in the window's title bar, so the empty part of
 * the strip moves the window there.
 */
export function PaneHeader({ group, position, tabs, active, splittable, closable, trailing, onSelect, onClose, onNewTab, onDropTab, onSplit, onClosePane, menu }: {
  group: string
  /** 1-based pane number, used in accessible names when there are several. */
  position?: number
  tabs: PaneTab[]
  active: string | null
  splittable: boolean
  closable: boolean
  /** Extra controls at the end of the strip, e.g. the assistant toggle on the top-right pane. */
  trailing?: ReactNode
  onSelect(key: string): void
  onClose(key: string): void
  onNewTab(): void
  /** A tab from any pane was dropped here; with `before`, ahead of that tab. */
  onDropTab(dragged: { group: string; key: string }, before?: string): void
  onSplit(direction: 'row' | 'column'): void
  onClosePane(): void
  /** Further pane actions, such as moving the shown tab. */
  menu: MenuItem[]
}) {
  const [insertBefore, setInsertBefore] = useState<string | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  // Keep the shown tab in view when a narrow pane scrolls its tab strip.
  useEffect(() => { strip.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [active, tabs.length])
  const paneName = position ? ` pane ${position}` : ''
  const read = (data: DataTransfer): { group: string; key: string } | null => {
    try {
      const value = JSON.parse(data.getData(tabDragType)) as { group?: unknown; key?: unknown }
      return typeof value.group === 'string' && typeof value.key === 'string' ? { group: value.group, key: value.key } : null
    } catch { return null }
  }
  const items: MenuItem[] = [
    ...(splittable ? [{ id: 'split-right', label: 'Split right', icon: <Columns2 size={14}/>, run: () => onSplit('row') },
      { id: 'split-down', label: 'Split down', icon: <Rows2 size={14}/>, run: () => onSplit('column') }] : []),
    ...menu,
    ...(closable ? [{ id: 'close-pane', label: 'Close pane', icon: <SquareX size={14}/>, separated: true, run: onClosePane }] : [])
  ]
  return <div className="pane-header">
    <div className="tab-strip" ref={strip} role="navigation" aria-label={`Tabs${paneName}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(tabDragType)) { event.preventDefault(); event.stopPropagation() } }}
      onDrop={(event) => { const dragged = read(event.dataTransfer); setInsertBefore(null); if (dragged) { event.preventDefault(); event.stopPropagation(); onDropTab(dragged) } }}>
      {tabs.map(({ key, tab, title }) => <div key={key} className={`tab ${active === key ? 'active' : ''}`} draggable data-insert-before={insertBefore === key ? 'true' : undefined}
        onDragStart={(event) => { event.dataTransfer.setData(tabDragType, JSON.stringify({ group, key })); event.dataTransfer.effectAllowed = 'move' }}
        onDragOver={(event) => { if (!event.dataTransfer.types.includes(tabDragType)) return; event.preventDefault(); event.stopPropagation(); setInsertBefore(key) }}
        onDragLeave={() => setInsertBefore(null)}
        onDrop={(event) => { const dragged = read(event.dataTransfer); setInsertBefore(null); if (!dragged) return; event.preventDefault(); event.stopPropagation(); onDropTab(dragged, key) }}
        onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(key) } }}>
        <button type="button" className="tab-label" title={title} onClick={() => onSelect(key)} aria-current={active === key ? 'page' : undefined}>
          <TabIcon tab={tab}/><span>{title}</span>
        </button>
        <button type="button" className="tab-close" onClick={(event) => {
          const pane = event.currentTarget.closest<HTMLElement>('.pane')
          const element = event.currentTarget.closest<HTMLElement>('.tab')
          const neighbor = element?.nextElementSibling?.querySelector<HTMLButtonElement>('.tab-label') ?? element?.previousElementSibling?.querySelector<HTMLButtonElement>('.tab-label')
          onClose(key)
          requestAnimationFrame(() => { if (neighbor?.isConnected) neighbor.focus(); else pane?.focus() })
        }} aria-label={`Close ${title}`} title={`Close ${title}`}><X size={13}/></button>
      </div>)}
      <button type="button" className="icon-btn new-tab" onClick={onNewTab} aria-label={`New tab${paneName}`} title="New tab"><Plus size={15}/></button>
      <div className="tab-strip-fill"/>
    </div>
    <div className="pane-actions">
      <MenuButton label={`Pane actions${paneName}`} title="Pane actions" items={items} align="end"><MoreHorizontal size={16}/></MenuButton>
      {trailing}
    </div>
  </div>
}
