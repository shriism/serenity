import { useEffect, useRef } from 'react'
import { FileText, Link2, NotebookText, X } from 'lucide-react'
import type { TabKind } from './resource-routing'
import { tabDragType } from './pane-layout'

export interface WorkspaceTabItem { key: string; kind: TabKind; title: string }

const icons = { entity: Link2, document: FileText, page: NotebookText }

export function WorkspaceTabs({ tabs, active, group, onSelect, onClose }: {
  tabs: WorkspaceTabItem[]
  /** The pane these tabs belong to, carried when a tab is dragged to another pane. */
  group: string
  active: string | null
  onSelect(key: string): void
  onClose(key: string): void
}) {
  const strip = useRef<HTMLElement>(null)
  // Keep the shown tab in view when a narrow group scrolls its tab strip.
  useEffect(() => { strip.current?.querySelector('.workspace-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [active, tabs.length])
  if (!tabs.length) return null
  return <nav className="workspace-tabs" aria-label="Open files" ref={strip}>
    {tabs.map((tab) => {
      const Icon = icons[tab.kind]
      return <div className={`workspace-tab ${active === tab.key ? 'active' : ''}`} key={tab.key} draggable
        onDragStart={(event) => { event.dataTransfer.setData(tabDragType, JSON.stringify({ group, key: tab.key })); event.dataTransfer.effectAllowed = 'move' }}>
        <button className="workspace-tab-label" title={tab.title} onClick={() => onSelect(tab.key)} aria-current={active === tab.key ? 'page' : undefined}>
          <Icon size={14}/><span>{tab.title}</span>
        </button>
        <button className="workspace-tab-close" onClick={() => onClose(tab.key)} aria-label={`Close ${tab.title}`} title={`Close ${tab.title}`}><X size={13}/></button>
      </div>
    })}
  </nav>
}
