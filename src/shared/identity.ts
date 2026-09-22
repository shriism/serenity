import type { Entity } from './types'

function tokens(text: string): string[] {
  return text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
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
