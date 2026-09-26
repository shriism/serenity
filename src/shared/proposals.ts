import type { Proposal } from './types'

export interface ProposalSource { source: string; proposals: Proposal[]; pending: number }

/**
 * Proposals grouped by where their evidence came from, so a document's suggestions can be checked against it together.
 * Sources with pending proposals come first, then by most recent activity; within a source, pending comes first.
 */
export function proposalsBySource(proposals: readonly Proposal[]): ProposalSource[] {
  const groups = new Map<string, Proposal[]>()
  for (const proposal of proposals) groups.set(proposal.source, [...(groups.get(proposal.source) ?? []), proposal])
  const latest = (items: Proposal[]): string => items.reduce((max, item) => item.recordedAt > max ? item.recordedAt : max, '')
  return [...groups].map(([source, items]) => ({
    source,
    proposals: [...items].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.recordedAt.localeCompare(a.recordedAt)),
    pending: items.filter((item) => item.status === 'pending').length
  })).sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0) || latest(b.proposals).localeCompare(latest(a.proposals)))
}
