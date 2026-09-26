import type { Entity, IdentityDecision, MergeRecord, WorkspaceSnapshot } from './types'

/** Resolve an archived entity through current merge redirects, stopping on malformed cycles. */
export function entityRepresentative(id: string, merges: readonly Pick<MergeRecord, 'id' | 'target'>[]): string {
  const redirects = new Map(merges.map((merge) => [merge.id, merge.target]))
  const seen = new Set<string>()
  let current = id
  while (redirects.has(current) && !seen.has(current)) { seen.add(current); current = redirects.get(current)! }
  return current
}

export function distinctRepresentatives(decision: Pick<IdentityDecision, 'left' | 'right'>, merges: readonly Pick<MergeRecord, 'id' | 'target'>[]): [string, string] {
  return [entityRepresentative(decision.left, merges), entityRepresentative(decision.right, merges)]
}

function tokens(text: string): string[] {
  return text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
}

/** Share of distinct name words two titles have in common; 1 for the same words in the same order. */
export function nameSimilarity(left: string, right: string): number {
  const a = tokens(left)
  const b = tokens(right)
  if (!a.length || !b.length) return 0
  if (a.join(' ') === b.join(' ')) return 1
  return a.filter((word) => b.includes(word)).length / new Set([...a, ...b]).size
}

export function identityCandidates(name: string, type: string, entities: Entity[]): { entity: Entity; score: number }[] {
  const words = tokens(name)
  if (!words.length) return []
  return entities.map((entity) => {
    const existing = tokens(entity.title)
    const overlap = words.filter((word) => existing.includes(word)).length
    const all = new Set([...words, ...existing]).size
    const same = words.join(' ') === existing.join(' ')
    const nameScore = same ? 1 : all ? overlap / all : 0
    const score = Math.min(1, nameScore * 0.85 + (type && type.toLowerCase() === entity.type.toLowerCase() ? 0.15 : 0))
    return { entity, score }
  }).filter((candidate) => candidate.score >= 0.35).sort((a, b) => b.score - a.score)
}

export interface DuplicateCandidate { a: Entity; b: Entity; score: number; reasons: string[] }

// A word or fact shared by more entities than this (a common first name, a shared "type: student") says little about
// identity, and pairing every holder would be quadratic. Such pairs are still found through anything rarer they share.
const distinctiveLimit = 50
const maxCandidates = 200

/**
 * Pairs of existing entities that may describe the same identity, with the evidence for each. These are prompts for a
 * human decision, never automatic merges. An undone merge or active distinct-identity decision suppresses its pair.
 */
export function duplicateCandidates(snapshot: Pick<WorkspaceSnapshot, 'entities' | 'claims' | 'mergeHistory'> & Partial<Pick<WorkspaceSnapshot, 'identityDecisions' | 'merges'>>): DuplicateCandidate[] {
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]))
  const facts = new Map<string, Map<string, string>>()
  for (const claim of snapshot.claims) {
    if (claim.status !== 'confirmed' || !entities.has(claim.subject)) continue
    const key = `${claim.key.trim().toLowerCase()}\u0000${claim.value.trim().toLowerCase()}`
    const shown = `${claim.key.trim()}: ${entities.get(claim.value)?.title ?? claim.value.trim()}`
    facts.set(claim.subject, (facts.get(claim.subject) ?? new Map()).set(key, shown))
  }
  const buckets = new Map<string, string[]>()
  const add = (bucket: string, id: string): void => { const ids = buckets.get(bucket); if (!ids) buckets.set(bucket, [id]); else if (ids.at(-1) !== id) ids.push(id) }
  for (const entity of snapshot.entities) {
    add(`title\u0000${tokens(entity.title).join(' ')}`, entity.id)
    for (const token of new Set(tokens(entity.title))) add(`word\u0000${token}`, entity.id)
    for (const fact of facts.get(entity.id)?.keys() ?? []) add(`fact\u0000${fact}`, entity.id)
  }
  const separated = new Set(snapshot.mergeHistory.filter((merge) => merge.undoneAt).flatMap((merge) => [`${merge.id}|${merge.target}`, `${merge.target}|${merge.id}`]))
  for (const decision of snapshot.identityDecisions ?? []) if (!decision.undoneAt) {
    const [left, right] = distinctRepresentatives(decision, snapshot.merges ?? [])
    separated.add(`${left}|${right}`)
    separated.add(`${right}|${left}`)
  }
  const seen = new Set<string>()
  const candidates: DuplicateCandidate[] = []
  for (const [bucket, ids] of buckets) {
    // Identical titles are always compared; words and facts only while they are distinctive.
    if (ids.length < 2 || (!bucket.startsWith('title') && ids.length > distinctiveLimit)) continue
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [entities.get(ids[i])!, entities.get(ids[j])!].sort((x, y) => x.title.localeCompare(y.title) || x.id.localeCompare(y.id))
      const key = `${a.id}|${b.id}`
      if (seen.has(key) || separated.has(key)) continue
      seen.add(key)
      const name = nameSimilarity(a.title, b.title)
      const aFacts = facts.get(a.id)
      const bFacts = facts.get(b.id)
      const shared = aFacts && bFacts ? [...aFacts].filter(([fact]) => bFacts.has(fact)).map(([, shown]) => `Both have ${shown}`) : []
      // Shared facts can support a weaker name match, e.g. two spellings of one person with the same email.
      if (name < (shared.length ? 0.3 : 0.34)) continue
      const sameType = a.type.trim().toLowerCase() === b.type.trim().toLowerCase()
      const score = Math.min(1, name + (sameType ? 0.1 : 0) + shared.length * 0.15)
      if (score < 0.5) continue
      candidates.push({ a, b, score, reasons: [name >= 0.99 ? 'Same name' : 'Similar names',
        sameType ? `Both are ${a.type}` : `Different types: ${a.type} and ${b.type}`, ...shared] })
    }
  }
  return candidates.sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title)).slice(0, maxCandidates)
}
