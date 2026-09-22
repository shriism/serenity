import { createHash } from 'node:crypto'
import type { SearchResult, SharedContext, WorkspaceSnapshot } from '../shared/types'

export interface ContextRecord {
  ref: string
  title: string
  text: string
}

export interface PreparedContext {
  text: string
  shared: SharedContext
}

const maxContext = 180000
const maxExcerpt = 9000

export function contextRecords(snapshot: WorkspaceSnapshot, documents: { name: string; text: string }[]): ContextRecord[] {
  return [
    ...snapshot.entities.map((item) => ({ ref: `entity:${item.id}`, title: item.title, text: JSON.stringify({ title: item.title, type: item.type, body: item.body, source: item.source }) })),
    ...snapshot.archivedEntities.map((item) => ({ ref: `archived:${item.id}`, title: item.title, text: JSON.stringify({ archived: true, title: item.title, type: item.type, body: item.body }) })),
    ...snapshot.claims.map((item) => ({ ref: `claim:${item.id}`, title: `${item.key}: ${item.value}`, text: JSON.stringify(item) })),
    ...snapshot.proposals.filter((item) => item.status === 'pending').map((item) => ({ ref: `proposal:${item.id}`, title: `Unconfirmed ${item.kind}`, text: JSON.stringify(item) })),
    ...snapshot.merges.map((item) => ({ ref: `merge:${item.id}`, title: `Merge ${item.title}`, text: JSON.stringify(item) })),
    ...snapshot.resolutions.map((item) => ({ ref: `resolution:${item.id}`, title: `Resolution ${item.key}`, text: JSON.stringify(item) })),
    ...(snapshot.modules.tasks ? snapshot.tasks.map((item) => ({ ref: `task:${item.id}`, title: item.title, text: JSON.stringify(item) })) : []),
    ...(snapshot.modules.calendar ? snapshot.events.map((item) => ({ ref: `event:${item.id}`, title: item.title, text: JSON.stringify(item) })) : []),
    ...snapshot.conversations.filter((item) => item.retained).map((item) => ({ ref: `conversation:${item.id}`, title: item.title, text: JSON.stringify(item.messages.map(({ role, text, provider, recordedAt }) => ({ role, text, provider, recordedAt }))) })),
    ...documents.map((item) => ({ ref: `document:${item.name}`, title: item.name, text: item.text }))
  ]
}

function evidence(record: ContextRecord, text: string, startCharacter = 0) {
  return { ref: record.ref, title: record.title, startCharacter, sentCharacters: text.length, totalCharacters: record.text.length,
    checksum: createHash('sha256').update(text).digest('hex') }
}

export function prepareContext(records: ContextRecord[], question: string, matches: SearchResult[], requested: string[] = [], offsets: Record<string, number> = {}): PreparedContext {
  const full = JSON.stringify(records)
  if (full.length <= maxContext && !requested.length) {
    return { text: full, shared: { mode: 'full', records: records.map((item) => evidence(item, item.text)),
      availableCount: records.length, catalogShown: records.length, sentCharacters: full.length } }
  }

  const manifest = records.slice(0, 1200).map(({ ref, title }) => ({ ref, title }))
  const queryTerms = question.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 2) ?? []
  const prioritized = [
    ...requested.flatMap((ref) => records.filter((item) => item.ref === ref)),
    ...matches.flatMap((match) => records.filter((item) => {
      if (item.ref === `${match.kind}:${match.id}`) return true
      if (match.kind === 'claim' && item.ref.startsWith('claim:')) return item.text.includes(`"subject":"${match.id}"`)
      return false
    })),
    ...records.filter((item) => queryTerms.some((term) => item.title.toLowerCase().includes(term)))
  ]
  const selected: ContextRecord[] = []
  const starts = new Map<string, number>()
  const seen = new Set<string>()
  const base = { catalog: manifest, catalogOmitted: records.length - manifest.length, availableCount: records.length }
  for (const record of prioritized) {
    if (seen.has(record.ref)) continue
    seen.add(record.ref)
    const occurrence = queryTerms.map((word) => record.text.toLowerCase().indexOf(word)).find((index) => index >= 0) ?? 0
    const start = Math.min(Math.max(0, offsets[record.ref] ?? occurrence - 1200), Math.max(0, record.text.length - 1))
    const end = Math.min(record.text.length, start + maxExcerpt)
    const excerpt = record.text.length > maxExcerpt ? `[Record excerpt ${start}-${end} of ${record.text.length} characters]\n${record.text.slice(start, end)}` : record.text
    const candidate = [...selected, { ...record, text: excerpt }]
    if (JSON.stringify({ ...base, selected: candidate }).length > maxContext) break
    selected.push({ ...record, text: excerpt })
    starts.set(record.ref, start)
  }
  const payload = JSON.stringify({ ...base, selected, selectionNote: 'Only the selected excerpts are included. The catalog identifies additional eligible workspace records.' })
  if (payload.length > maxContext) throw new Error('Workspace catalog exceeds provider context capacity. Search a narrower workspace or reduce its record count.')
  return { text: payload, shared: { mode: 'retrieved', records: selected.map((item) => {
    const original = records.find((record) => record.ref === item.ref)!
    return evidence(original, item.text, starts.get(item.ref) ?? 0)
  }), availableCount: records.length, catalogShown: manifest.length, sentCharacters: payload.length } }
}
