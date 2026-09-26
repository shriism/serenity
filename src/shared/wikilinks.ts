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

export interface Mention { uri: string; title: string; excerpt: string }

/**
 * Pages and entity narratives whose wikilinks resolve to `uri`: the resource's backlinks. Ambiguous names are not
 * counted, since the writer's intent is unknown. The excerpt is the line holding the first mention.
 */
export function wikilinkMentions(snapshot: Pick<WorkspaceSnapshot, 'pages' | 'entities' | 'documents'>, uri: string): Mention[] {
  const cache = new Map<string, WikiResolution>()
  const resolve = (target: string): WikiResolution => {
    const key = normalized(target)
    if (!cache.has(key)) cache.set(key, resolveWikilink(snapshot, target))
    return cache.get(key)!
  }
  const sources = [
    ...snapshot.pages.map((page) => ({ uri: resourceUri({ kind: 'page', id: page.id }), title: page.title, text: page.body })),
    ...snapshot.entities.map((entity) => ({ uri: resourceUri({ kind: 'entity', id: entity.id }), title: entity.title, text: entity.body }))
  ]
  return sources.flatMap((source) => {
    if (source.uri === uri || !source.text.includes('[[')) return []
    const line = source.text.split('\n').find((text) => [...text.matchAll(wikilink)].some((match) => {
      const result = resolve(match[1])
      return result.kind === 'resolved' && result.uri === uri
    }))
    return line ? [{ uri: source.uri, title: source.title, excerpt: line.trim().slice(0, 200) }] : []
  })
}

/** An unfinished `[[query` ending at the caret on the current line, if the person is typing a wikilink. */
export function wikilinkQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const line = text.slice(text.lastIndexOf('\n', caret - 1) + 1, caret)
  const open = line.lastIndexOf('[[')
  if (open < 0 || line.slice(open).includes(']]') || /[[\]|#]/.test(line.slice(open + 2))) return null
  return { start: caret - line.length + open + 2, query: line.slice(open + 2) }
}

/** Replaces the query typed after `[[` with a title and closes the link, returning the new text and caret. */
export function completeWikilink(text: string, caret: number, start: number, title: string): { text: string; caret: number } {
  const closed = text.slice(caret).startsWith(']]')
  const inserted = `${title}${closed ? '' : ']]'}`
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length + (closed ? 2 : 0) }
}

/** Titles a wikilink could name without being ambiguous, best matches first. */
export function wikilinkSuggestions(snapshot: Pick<WorkspaceSnapshot, 'pages' | 'entities' | 'documents'>, query: string, limit = 8): { title: string; kind: string }[] {
  const wanted = normalized(query)
  const all = [...snapshot.pages.map((page) => ({ title: page.title, kind: 'page' })), ...snapshot.entities.map((entity) => ({ title: entity.title, kind: entity.type || 'entity' })),
    ...snapshot.documents.map((document) => ({ title: document.name, kind: 'document' }))]
  const counts = new Map<string, number>()
  for (const item of all) counts.set(normalized(item.title), (counts.get(normalized(item.title)) ?? 0) + 1)
  return all.filter((item) => counts.get(normalized(item.title)) === 1 && normalized(item.title).includes(wanted))
    .sort((a, b) => Number(!normalized(a.title).startsWith(wanted)) - Number(!normalized(b.title).startsWith(wanted)) || a.title.localeCompare(b.title))
    .slice(0, limit)
}
