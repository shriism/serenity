import { FilePlus2, FileText, FileUp } from 'lucide-react'
import type { WorkspaceSnapshot } from '../../shared/types'

interface Props {
  workspace: WorkspaceSnapshot
  onImport(): void
  onNew(): void
  onAnalyze(name: string): void
  onOpen(name: string): void
}

export function DocumentsPanel({ workspace, onImport, onNew, onAnalyze, onOpen }: Props) {
  return <section className="page wide">
    <header className="view-header"><div><h1>Documents</h1><p className="view-subtitle">Imported files are copied into this workspace. Text, Markdown, PDF, and Word documents can be searched and analyzed.</p></div>
      <div className="view-actions"><button className="primary" onClick={onNew}><FilePlus2 size={15}/> New</button><button className="secondary" onClick={onImport}><FileUp size={15}/> Import…</button></div></header>
    {workspace.documents.length === 0 && <div className="empty-state"><FileText size={22}/><h2>No documents yet</h2><p>Import files to read them here, search their text, and ask the assistant to analyze them, or start a new Markdown document.</p></div>}
    <div className="document-list">
      {workspace.documents.map((item) => <div key={item.name} className="document-row">
        <FileText size={16} aria-hidden="true"/><button className="document-name" onClick={() => onOpen(item.name)} title={item.extractable ? `Read ${item.name}` : `Open ${item.name} in its app`}>{item.name}</button>
        <small>{item.size < 1024 * 1024 ? `${Math.max(1, Math.round(item.size / 1024))} KB` : `${(item.size / 1024 / 1024).toFixed(1)} MB`}{item.extractable ? '' : ' · opens in its app'}</small>
        {item.extractable && <button className="secondary" onClick={() => onAnalyze(item.name)}>Analyze</button>}
      </div>)}
    </div>
  </section>
}
