import type { SearchResult } from './types'

const normalized = (text: string): string => text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Orders full-text matches for a person looking for something by name: an exact title first, then titles that start
 * with the query, then the index's own order (records matching every word before those matching some). Duplicates of
 * the same record are dropped.
 */
export function rankSearchResults(query: string, results: readonly SearchResult[]): SearchResult[] {
  const target = normalized(query)
  const seen = new Set<string>()
  const unique = results.filter((result) => {
    const key = `${result.kind}\u0000${result.id}\u0000${result.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const tier = (result: SearchResult): number => {
    const title = normalized(result.title)
    return title === target ? 0 : target && title.startsWith(target) ? 1 : 2
  }
  return unique.map((result, index) => ({ result, index, tier: tier(result) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index).map(({ result }) => result)
}
