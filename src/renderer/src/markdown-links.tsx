import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { defaultUrlTransform } from 'react-markdown'
import { parseResourceUri } from '../../shared/resources'
import { unresolvedScheme } from '../../shared/wikilinks'
import { externalLink } from '../../shared/external-links'

/** Keeps workspace resource, command, and unresolved-wikilink URLs, which Markdown's default filter would drop. */
export const markdownUrlTransform = (url: string): string =>
  parseResourceUri(url) || /^serenity:command\/[a-z0-9.-]+$/.test(url) || url.startsWith(unresolvedScheme) ? url : defaultUrlTransform(url)

/**
 * Renders a link in workspace Markdown: resource links open (Cmd/Ctrl-click opens them in the next pane), and
 * web links open in the system browser, and wikilinks that matched nothing or several things say so instead of
 * guessing. Returns null for other links.
 */
export function workspaceLink(href: string | undefined, children: ReactNode, onOpen: (uri: string, side: boolean) => void): ReactNode | null {
  if (!href) return null
  if (parseResourceUri(href)) return <button className="page-link" onClick={(event) => onOpen(href, event.metaKey || event.ctrlKey)}>{children}<ArrowUpRight size={14}/></button>
  if (externalLink(href)) return <a className="external-link" href={href} title={`Open ${href} in your browser`}
    onClick={(event) => { event.preventDefault(); void window.serenity.openExternal(href) }}>{children}<ArrowUpRight size={12}/></a>
  if (!href.startsWith(unresolvedScheme)) return null
  const [reason, ...rest] = href.slice(unresolvedScheme.length).split('/')
  const detail = decodeURIComponent(rest.join('/'))
  return reason === 'ambiguous'
    ? <span className="wikilink-unresolved" title={`Several items have this name: ${detail}. Use a serenity: link to choose one.`}>{children}</span>
    : <span className="wikilink-unresolved missing" title={`Nothing in this workspace is called “${detail}” yet`}>{children}</span>
}
