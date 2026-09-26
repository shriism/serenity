import type { Entity, WorkspaceSnapshot } from './types'

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

/**
 * Pairs of existing entities that may describe the same identity, with the evidence for each. These are prompts for a
 * human decision, never automatic merges. A pair whose merge was undone was judged distinct and is not suggested again.
 */
export function duplicateCandidates(snapshot: Pick<WorkspaceSnapshot, 'entities' | 'claims' | 'mergeHistory'>): DuplicateCandidate[] {
  const byToken = new Map<string, Entity[]>()
  for (const entity of snapshot.entities) for (const token of new Set(tokens(entity.title))) byToken.set(token, [...(byToken.get(token) ?? []), entity])
  const separated = new Set(snapshot.mergeHistory.filter((merge) => merge.undoneAt).flatMap((merge) => [`${merge.id}|${merge.target}`, `${merge.target}|${merge.id}`]))
  const confirmed = snapshot.claims.filter((claim) => claim.status === 'confirmed')
  const facts = (id: string): Set<string> => new Set(confirmed.filter((claim) => claim.subject === id).map((claim) => `${claim.key.trim().toLowerCase()}\u0000${claim.value.trim().toLowerCase()}`))
  const titles = new Map(snapshot.entities.map((entity) => [entity.id, entity.title]))
  const seen = new Set<string>()
  const candidates: DuplicateCandidate[] = []
  for (const group of byToken.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const [a, b] = group[i].title.localeCompare(group[j].title) <= 0 ? [group[i], group[j]] : [group[j], group[i]]
      const key = `${a.id}|${b.id}`
      if (a.id === b.id || seen.has(key) || separated.has(key)) continue
      seen.add(key)
      const name = nameSimilarity(a.title, b.title)
      const sameType = a.type.trim().toLowerCase() === b.type.trim().toLowerCase()
      const shared = [...facts(a.id)].filter((fact) => facts(b.id).has(fact)).map((fact) => {
        const [factKey, value] = fact.split('\u0000')
        const original = confirmed.find((claim) => claim.value.trim().toLowerCase() === value)?.value ?? value
        return `Both have ${factKey}: ${titles.get(original) ?? original}`
      })
      const score = Math.min(1, name + (sameType ? 0.1 : 0) + shared.length * 0.15)
      // Shared facts can support a weaker name match, e.g. two spellings of one person with the same email.
      if (name < (shared.length ? 0.3 : 0.34) || score < 0.5) continue
      candidates.push({ a, b, score, reasons: [
        name >= 0.99 ? 'Same name' : `Similar names`,
        ...(sameType ? [`Both are ${a.type}`] : [`Different types: ${a.type} and ${b.type}`]),
        ...shared
      ] })
    }
  }
  return candidates.sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title))
}
