import { FileText, Link2, NotebookText, X } from 'lucide-react'
import type { TabKind } from './resource-routing'

export interface WorkspaceTabItem { key: string; kind: TabKind; title: string }

const icons = { entity: Link2, document: FileText, page: NotebookText }

export function WorkspaceTabs({ tabs, active, onSelect, onClose }: {
  tabs: WorkspaceTabItem[]
  active: string | null
  onSelect(key: string): void
  onClose(key: string): void
}) {
  if (!tabs.length) return null
  return <nav className="workspace-tabs" aria-label="Open files">
    {tabs.map((tab) => {
      const Icon = icons[tab.kind]
      return <div className={`workspace-tab ${active === tab.key ? 'active' : ''}`} key={tab.key}>
        <button className="workspace-tab-label" title={tab.title} onClick={() => onSelect(tab.key)} aria-current={active === tab.key ? 'page' : undefined}>
          <Icon size={14}/><span>{tab.title}</span>
        </button>
        <button className="workspace-tab-close" onClick={() => onClose(tab.key)} aria-label={`Close ${tab.title}`} title={`Close ${tab.title}`}><X size={13}/></button>
      </div>
    })}
  </nav>
}
