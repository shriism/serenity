import { useEffect, useRef, useState } from 'react'
import { FileText, Link2, NotebookText, X } from 'lucide-react'
import type { TabKind } from './resource-routing'
import { tabDragType } from './pane-layout'

export interface WorkspaceTabItem { key: string; kind: TabKind; title: string }

const icons = { entity: Link2, document: FileText, page: NotebookText }

export function WorkspaceTabs({ tabs, active, group, onSelect, onClose, onDropTab }: {
  tabs: WorkspaceTabItem[]
  /** The pane these tabs belong to, carried when a tab is dragged to another pane. */
  group: string
  active: string | null
  onSelect(key: string): void
  /** Returns false when a dirty editor cancels the close. */
  onClose(key: string): boolean
  /** A tab from any pane was dropped onto one of these tabs, to be placed before it. */
  onDropTab(dragged: { group: string; key: string }, before: string): void
}) {
  const [insertBefore, setInsertBefore] = useState<string | null>(null)
  const strip = useRef<HTMLElement>(null)
  // Keep the shown tab in view when a narrow group scrolls its tab strip.
  useEffect(() => { strip.current?.querySelector('.workspace-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [active, tabs.length])
  if (!tabs.length) return null
  return <nav className="workspace-tabs" aria-label="Open files" ref={strip}>
    {tabs.map((tab) => {
      const Icon = icons[tab.kind]
      return <div className={`workspace-tab ${active === tab.key ? 'active' : ''}`} key={tab.key} draggable
        data-insert-before={insertBefore === tab.key ? 'true' : undefined}
        onDragStart={(event) => { event.dataTransfer.setData(tabDragType, JSON.stringify({ group, key: tab.key })); event.dataTransfer.effectAllowed = 'move' }}
        onDragOver={(event) => { if (!event.dataTransfer.types.includes(tabDragType)) return; event.preventDefault(); event.stopPropagation(); setInsertBefore(tab.key) }}
        onDragLeave={() => setInsertBefore(null)}
        onDrop={(event) => {
          setInsertBefore(null)
          try {
            const dragged = JSON.parse(event.dataTransfer.getData(tabDragType)) as { group?: unknown; key?: unknown }
            if (typeof dragged.group !== 'string' || typeof dragged.key !== 'string') return
            event.preventDefault()
            event.stopPropagation()
            onDropTab({ group: dragged.group, key: dragged.key }, tab.key)
          } catch { /* Not a tab from this window. */ }
        }}>
        <button className="workspace-tab-label" title={tab.title} onClick={() => onSelect(tab.key)} aria-current={active === tab.key ? 'page' : undefined}>
          <Icon size={14}/><span>{tab.title}</span>
        </button>
        <button className="workspace-tab-close" onClick={(event) => {
          const pane = event.currentTarget.closest<HTMLElement>('.editor-group')
          const tabElement = event.currentTarget.closest<HTMLElement>('.workspace-tab')
          const neighbor = tabElement?.nextElementSibling?.querySelector<HTMLButtonElement>('.workspace-tab-label') ??
            tabElement?.previousElementSibling?.querySelector<HTMLButtonElement>('.workspace-tab-label')
          if (onClose(tab.key)) requestAnimationFrame(() => {
            if (active !== tab.key && neighbor?.isConnected) neighbor.focus()
            else pane?.focus()
          })
        }} aria-label={`Close ${tab.title}`} title={`Close ${tab.title}`}><X size={13}/></button>
      </div>
    })}
  </nav>
}
