import type { WorkspaceSnapshot } from '../../shared/types'

interface Props {
  workspace: WorkspaceSnapshot
  onImport(): void
  onAnalyze(name: string): void
}

export function DocumentsPanel({ workspace, onImport, onAnalyze }: Props) {
  return <section className="page">
    <span className="eyebrow">SOURCES</span><h1>Documents</h1>
    <p>Imported files are copied into your workspace. Serenity can search and analyze text, PDF, and DOCX content.</p>
    <button className="primary" onClick={onImport}>Import documents +</button>
    <div className="document-list">
      {workspace.documents.map((item) => <div key={item.name} className="document-row">
        <span>▤</span><strong>{item.name}</strong>
        <small>{Math.round(item.size / 1024)} KB · {item.extractable ? 'Text format supported' : 'No text extraction for this format'}</small>
        {item.extractable && <button className="text-button" onClick={() => onAnalyze(item.name)}>Analyze ↗</button>}
      </div>)}
    </div>
  </section>
}
