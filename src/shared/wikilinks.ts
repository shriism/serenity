import type { WorkspaceSnapshot } from './types'
import { resourceUri } from './resources'

export type WikiResolution =
  | { kind: 'resolved'; uri: string; title: string }
  | { kind: 'ambiguous'; titles: string[] }
  | { kind: 'missing' }

/** Scheme for wikilinks that did not resolve to exactly one resource; rendered as text, never opened. */
export const unresolvedScheme = 'serenity-wikilink:'

const normalized = (text: string): string => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()

/**
 * Finds what `[[target]]` names: a page, entity, or document whose title (or file name, with or without extension)
 * matches exactly, ignoring case. Two or more matches are ambiguous rather than guessed.
 */
export function resolveWikilink(snapshot: Pick<WorkspaceSnapshot, 'pages' | 'entities' | 'documents'>, target: string): WikiResolution {
  const wanted = normalized(target)
  const matches = [
    ...snapshot.pages.filter((page) => normalized(page.title) === wanted).map((page) => ({ uri: resourceUri({ kind: 'page', id: page.id }), title: page.title })),
    ...snapshot.entities.filter((entity) => normalized(entity.title) === wanted).map((entity) => ({ uri: resourceUri({ kind: 'entity', id: entity.id }), title: `${entity.title} (${entity.type})` })),
    ...snapshot.documents.filter((document) => normalized(document.name) === wanted || normalized(document.name.replace(/\.[^.]+$/, '')) === wanted)
      .map((document) => ({ uri: resourceUri({ kind: 'document', id: document.name }), title: document.name }))
  ]
  if (matches.length === 1) return { kind: 'resolved', ...matches[0] }
  return matches.length ? { kind: 'ambiguous', titles: matches.map((match) => match.title) } : { kind: 'missing' }
}

const escapeLabel = (text: string): string => text.replace(/([\\[\]])/g, '\\$1')
// Parentheses would end a Markdown link destination early.
const encodeDetail = (text: string): string => encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29')
const wikilink = /(?<!!)\[\[([^[\]|#\n]+)(?:#[^[\]|\n]*)?(?:\|([^[\]\n]+))?\]\]/g

/**
 * Rewrites `[[Target]]` and `[[Target|label]]` as ordinary Markdown links before rendering. Fenced code blocks and
 * inline code are left untouched, as are `![[embeds]]`. Unresolved targets get a link in `unresolvedScheme` that
 * records why, so the renderer can show them without guessing.
 */
export function linkWikilinks(markdown: string, resolve: (target: string) => WikiResolution): string {
  let fence: string | null = null
  return markdown.split('\n').map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null; return line }
    if (marker) { fence = marker; return line }
    return line.split(/(`+[^`]*`+)/).map((part, index) => index % 2 ? part : part.replace(wikilink, (_whole, target: string, label?: string) => {
      const shown = escapeLabel((label ?? target).trim())
      const result = resolve(target)
      if (result.kind === 'resolved') return `[${shown}](${result.uri})`
      const detail = result.kind === 'ambiguous' ? `ambiguous/${encodeDetail(result.titles.join(' · '))}` : `missing/${encodeDetail(target.trim())}`
      return `[${shown}](${unresolvedScheme}${detail})`
    })).join('')
  }).join('\n')
}
