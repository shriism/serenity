import type { Autonomy, Proposal, WorkflowPermissions } from './types'

export const defaultWorkflowPermissions: Readonly<WorkflowPermissions> = {
  claims: true, entities: false, tasks: false, events: false
}

export function validateWorkflowPermissions(input: unknown): WorkflowPermissions {
  if (input === undefined) return { ...defaultWorkflowPermissions }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid workflow permissions')
  const settings = input as Record<string, unknown>
  if (['claims', 'entities', 'tasks', 'events'].some((name) => typeof settings[name] !== 'boolean')) {
    throw new Error('Each workflow permission must be explicitly enabled or disabled')
  }
  return { claims: settings.claims as boolean, entities: settings.entities as boolean,
    tasks: settings.tasks as boolean, events: settings.events as boolean }
}

export function canAutoApply(mode: Autonomy, permissions: WorkflowPermissions, proposal: Proposal,
  context: { knownCategories: string[]; identityCandidates: number; ambiguousIdentity?: boolean }): boolean {
  if (mode !== 'autonomous' || context.ambiguousIdentity) return false
  if (proposal.kind === 'claim') return permissions.claims
  if (proposal.kind === 'task') return permissions.tasks
  if (proposal.kind === 'event') return permissions.events
  return permissions.entities && context.identityCandidates === 0 &&
    context.knownCategories.some((category) => category.toLowerCase() === proposal.type.toLowerCase())
}
