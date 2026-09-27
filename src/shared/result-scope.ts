import type { ReadScope, SearchResult, WorkspaceSnapshot } from './types'

/**
 * The entities and documents a set of search results points to, as a selected read scope. Claim hits are indexed under
 * their subject entity. Pages, tasks, and events are left out: selected scope covers entities and documents, and other
 * record types are allowed separately.
 */
export function scopeFromResults(results: readonly SearchResult[], snapshot: Pick<WorkspaceSnapshot, 'entities' | 'documents'>): Pick<ReadScope, 'entityIds' | 'documentNames'> {
  const entities = new Set(snapshot.entities.map((entity) => entity.id))
  const documents = new Set(snapshot.documents.map((document) => document.name))
  const entityIds = [...new Set(results.filter((result) => (result.kind === 'entity' || result.kind === 'claim') && entities.has(result.id)).map((result) => result.id))]
  const documentNames = [...new Set(results.filter((result) => result.kind === 'document' && documents.has(result.id)).map((result) => result.id))]
  return { entityIds, documentNames }
}
