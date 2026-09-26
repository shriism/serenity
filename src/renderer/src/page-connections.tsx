import { useMemo } from 'react'
import type { WorkspacePage, WorkspaceSnapshot } from '../../shared/types'
import { pageOutgoingLinks, wikilinkMentions } from '../../shared/wikilinks'
import { parseResourceUri, resourceUri } from '../../shared/resources'

/** What an authored page points at, and the other authored text that names it. */
export function PageConnections({ page, workspace, onOpen }: {
  page: WorkspacePage
  workspace: WorkspaceSnapshot
  onOpen(uri: string, side: boolean): void
}) {
  const outgoing = useMemo(() => pageOutgoingLinks(workspace, page.body), [workspace, page.body])
  const incoming = useMemo(() => wikilinkMentions(workspace, resourceUri({ kind: 'page', id: page.id })), [workspace, page.id])
  return <section className="page page-connections" aria-label={`${page.title} links`}>
    <h1>{page.title}</h1>
    <p>Follow the page's workspace links and see where it is mentioned. ⌘/Ctrl-click opens a linked item to the side.</p>
    <h2>Linked from this page</h2>
    {outgoing.length ? <ul className="page-links-list">{outgoing.map((link, index) => <li key={link.uri ?? `${link.title}:${index}`}>
      {link.uri ? <button onClick={(event) => onOpen(link.uri!, event.metaKey || event.ctrlKey)}><strong>{link.title}</strong><small>{link.detail}</small></button> :
        <div className="page-link-unresolved"><strong>{link.title}</strong><small>{link.detail}</small></div>}
      <p>{link.excerpt}</p>
    </li>)}</ul> : <p className="hint">No workspace links in this page yet. Add a [[wikilink]] or a serenity: resource link while editing it.</p>}
    <h2>Mentioned in</h2>
    {incoming.length ? <ul className="page-links-list">{incoming.map((mention) => <li key={mention.uri}>
      <button onClick={(event) => onOpen(mention.uri, event.metaKey || event.ctrlKey)}><strong>{mention.title}</strong><small>{parseResourceUri(mention.uri)?.kind}</small></button>
      <p>{mention.excerpt}</p>
    </li>)}</ul> : <p className="hint">No other page or note mentions this page with a [[wikilink]] yet.</p>}
  </section>
}
