import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, CalendarDays, FileText, Link2, ListTodo, MessageCircle, Search } from 'lucide-react'
import type { ReadScope, SearchResult, WorkspaceSnapshot } from '../../shared/types'
import { resourceUri } from '../../shared/resources'
import { scopeFromResults } from '../../shared/result-scope'
import { highlighted } from './search-excerpt'

const icons = { entity: Link2, claim: Link2, document: FileText, task: ListTodo, event: CalendarDays, page: FileText }

/**
 * Search that stays open in a pane. Results open in the neighboring pane, so a set of matches can be worked through
 * without searching again; Cmd/Ctrl-click opens one in this pane instead.
 */
export function SearchView({ workspace, initialQuery, onOpenResource, onAsk }: {
  workspace: WorkspaceSnapshot
  initialQuery: string
  /** `side` opens in the next pane. */
  onOpenResource(uri: string, side: boolean): void
  onAsk(prompt: string, scope: Pick<ReadScope, 'entityIds' | 'documentNames'>): void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.focus() }, [])
  // Re-run when the workspace changes too, so the list reflects edits made in other panes.
  useEffect(() => {
    const request = ++sequence.current
    if (!query.trim()) { setResults(null); return }
    const timer = window.setTimeout(() => {
      window.serenity.search(query).then((found) => { if (request === sequence.current) { setResults(found); setError('') } },
        (cause) => { if (request === sequence.current) setError(String(cause)) })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [query, workspace.generation])
  const scope = useMemo(() => results?.length ? scopeFromResults(results, workspace) : null, [results, workspace])
  const uriOf = (result: SearchResult): string => resourceUri({ kind: result.kind === 'claim' && !workspace.claims.some((claim) => claim.id === result.id) ? 'entity' : result.kind, id: result.id })
  return <section className="page search-view" aria-label="Search">
    <label className="library-search search-view-field"><Search size={16}/><input ref={field} value={query} onChange={(event) => setQuery(event.target.value)}
      placeholder="Search this workspace" aria-label="Search this workspace"/></label>
    {error && <p className="page-query-error" role="alert">{error}</p>}
    {results && <p className="search-view-summary">{results.length ? `${results.length === 100 ? '100+' : results.length} ${results.length === 1 ? 'result' : 'results'} · opens in the next pane` : 'No matches.'}
      {scope && (scope.entityIds.length > 0 || scope.documentNames.length > 0) &&
        <button className="text-button" onClick={() => onAsk(`About “${query.trim()}”: `, scope)}><MessageCircle size={13}/> Ask about these results</button>}</p>}
    {results && results.length > 0 && <ul className="search-view-results">{results.map((result, index) => {
      const Icon = icons[result.kind]
      return <li key={`${result.kind}:${result.id}:${index}`}>
        <button onClick={(event) => onOpenResource(uriOf(result), !(event.metaKey || event.ctrlKey))}>
          <Icon size={15}/><span><strong>{result.title}</strong><small>{result.detail}</small>
            {result.excerpt && <span className="palette-excerpt">{highlighted(result.excerpt)}</span>}</span><ArrowUpRight size={13}/>
        </button>
      </li>
    })}</ul>}
    {!results && <p className="hint">Type to search titles, notes, claims, and document text. Results stay here while you open them beside this pane.</p>}
  </section>
}
