import type { Proposal, WorkspaceSnapshot } from './types'

const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function isDuplicateProposal(proposal: Proposal,
  knowledge: Pick<WorkspaceSnapshot, 'claims' | 'proposals' | 'tasks' | 'events'>): boolean {
  if (proposal.kind === 'claim') {
    const same = (item: { subject: string; key: string; value: string }): boolean =>
      item.subject === proposal.subject && normalize(item.key) === normalize(proposal.key) && normalize(item.value) === normalize(proposal.value)
    if (knowledge.claims.some((claim) => claim.status === 'confirmed' && same(claim))) return true
    return knowledge.proposals.some((item) => item.kind === 'claim' && same(item) &&
      (item.status !== 'rejected' || normalize(item.source) === normalize(proposal.source)))
  }
  if (proposal.kind === 'task') {
    const same = (item: { title: string; due?: string }): boolean => normalize(item.title) === normalize(proposal.title) && item.due === proposal.due
    return knowledge.tasks.some(same) || knowledge.proposals.some((item) => item.kind === 'task' && item.status !== 'rejected' && same(item))
  }
  if (proposal.kind === 'event') {
    const same = (item: { title: string; start: string }): boolean => normalize(item.title) === normalize(proposal.title) && item.start === proposal.start
    return knowledge.events.some(same) || knowledge.proposals.some((item) => item.kind === 'event' && item.status !== 'rejected' && same(item))
  }
  return knowledge.proposals.some((item) => item.kind === 'entity' && item.status === 'pending' &&
    normalize(item.title) === normalize(proposal.title) && normalize(item.type) === normalize(proposal.type) &&
    normalize(item.body) === normalize(proposal.body))
}
