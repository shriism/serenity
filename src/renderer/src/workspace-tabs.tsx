import { FileText, Link2, X } from 'lucide-react'

export type WorkspaceTab = { kind: 'entity' | 'document'; id: string; title: string }
export const tabRef = (tab: WorkspaceTab): string => `${tab.kind}:${tab.id}`

export function WorkspaceTabs({ tabs, active, onSelect, onClose }: {
  tabs: WorkspaceTab[]
  active: string | null
  onSelect(tab: WorkspaceTab): void
  onClose(tab: WorkspaceTab): void
}) {
  if (!tabs.length) return null
  return <nav className="workspace-tabs" aria-label="Open files">
    {tabs.map((tab) => <div className={`workspace-tab ${active === tabRef(tab) ? 'active' : ''}`} key={tabRef(tab)}>
      <button className="workspace-tab-label" title={tab.title} onClick={() => onSelect(tab)}>
        {tab.kind === 'entity' ? <Link2 size={14}/> : <FileText size={14}/>}<span>{tab.title}</span>
      </button>
      <button className="workspace-tab-close" onClick={() => onClose(tab)} aria-label={`Close ${tab.title}`} title={`Close ${tab.title}`}><X size={13}/></button>
    </div>)}
  </nav>
}
