import { resourceUri, type ResourceKind } from './resources'

/** A record an answer relies on, checked against what was actually shared with the provider. */
export interface Citation {
  ref: string
  title: string
  /** The record was part of the context sent for this answer. An unsent citation is the provider's unverified claim. */
  sent: boolean
  quote?: string
  /** The quoted excerpt occurs in the cited record. */
  quoteFound?: boolean
}

const maxCitations = 20
const maxQuote = 300
const refPattern = /^[a-z][a-z-]*:\S{1,280}$/

const normalized = (text: string): string => text.replace(/\\[nrt]/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Keeps well-formed citations from a provider response and records, for each, whether the record was actually sent and
 * whether its quote appears in it. Nothing is trusted just because the provider listed it.
 */
export function validateCitations(raw: unknown, sent: ReadonlySet<string>, records: ReadonlyMap<string, { title: string; text: string }>): Citation[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const citations: Citation[] = []
  for (const item of raw) {
    const ref = typeof item === 'string' ? item : item && typeof item === 'object' && typeof item.ref === 'string' ? item.ref as string : ''
    if (!refPattern.test(ref) || seen.has(ref)) continue
    seen.add(ref)
    const record = records.get(ref)
    const rawQuote = item && typeof item === 'object' && typeof item.quote === 'string' ? item.quote.trim() : ''
    const quote = rawQuote ? rawQuote.slice(0, maxQuote) : undefined
    citations.push({ ref, title: record?.title ?? ref, sent: sent.has(ref),
      ...(quote ? { quote, quoteFound: Boolean(record && normalized(record.text).includes(normalized(quote))) } : {}) })
    if (citations.length === maxCitations) break
  }
  return citations
}

const openable = new Set<ResourceKind>(['entity', 'claim', 'document', 'page', 'task', 'event', 'proposal', 'conversation'])

/** The workspace resource a context ref points to, when it can be opened. */
export function citationUri(ref: string): string | null {
  const separator = ref.indexOf(':')
  const kind = ref.slice(0, separator) as ResourceKind
  if (separator < 1 || !openable.has(kind)) return null
  try { return resourceUri({ kind, id: ref.slice(separator + 1) }) } catch { return null }
}

export type AnswerSegment = { text: string } | { citation: number }

/** Splits `[n]` markers that refer to one of `count` citations out of answer text; other brackets stay as text. */
export function answerSegments(text: string, count: number): AnswerSegment[] {
  const segments: AnswerSegment[] = []
  let last = 0
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    const number = Number(match[1])
    if (number < 1 || number > count) continue
    if (match.index > last) segments.push({ text: text.slice(last, match.index) })
    segments.push({ citation: number })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}
