import { useEffect, useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'

export function DocumentPreview({ name, onOpen, onError }: { name: string; onOpen(name: string): void; onError(message: string): void }) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let current = true
    setLoading(true)
    setContent(null)
    window.serenity.readDocument(name).then((text) => { if (current) setContent(text) })
      .catch((error) => { if (current) onError(String(error)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [name])
  return <section className="document-preview page">
    <header className="document-preview-header"><div><span className="eyebrow">WORKSPACE / DOCUMENTS</span><h1>{name}</h1><p>Stored in documents/{name}</p></div>
      <button className="secondary" onClick={() => onOpen(name)}><ExternalLink size={15}/> Open in default app</button></header>
    {loading ? <p className="hint">Reading document…</p> : content === null ? <div className="document-empty"><FileText size={26}/><p>Preview unavailable for this format.</p><button onClick={() => onOpen(name)}>Open in default app</button></div> :
      <article className="document-text" aria-label={`Text extracted from ${name}`}>{content || 'This document contains no extractable text.'}</article>}
  </section>
}
