import type { Entity } from './types'

const normalized = (text: string): string => text.normalize('NFKD').toLocaleLowerCase().trim()

/** Entity types with how many entities use each, most used first. Types are the person's own words, compared loosely. */
export function entityTypes(entities: readonly Entity[]): { type: string; count: number }[] {
  const counts = new Map<string, { type: string; count: number }>()
  for (const entity of entities) {
    const key = normalized(entity.type)
    const entry = counts.get(key)
    if (entry) entry.count++
    else counts.set(key, { type: entity.type.trim() || 'untyped', count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}

/** Entities whose title or type contains the query, optionally of one type; titles starting with the query first. */
export function filterEntities(entities: readonly Entity[], query: string, type: string | null): Entity[] {
  const wanted = normalized(query)
  const kind = type === null ? null : normalized(type === 'untyped' ? '' : type)
  return entities.filter((entity) => (kind === null || normalized(entity.type) === kind) &&
    (!wanted || normalized(entity.title).includes(wanted) || normalized(entity.type).includes(wanted)))
    .sort((a, b) => Number(!normalized(a.title).startsWith(wanted)) - Number(!normalized(b.title).startsWith(wanted)) || a.title.localeCompare(b.title))
}
