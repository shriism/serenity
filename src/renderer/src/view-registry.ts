import type { ModuleId } from '../../shared/modules'
import type { WorkspaceSnapshot } from '../../shared/types'
import type { ReactNode } from 'react'

export interface ViewContribution<Context> {
  id: string
  module?: ModuleId
  render(context: Context): ReactNode
}

export class ViewRegistry<Context extends { workspace: WorkspaceSnapshot }> {
  private views = new Map<string, ViewContribution<Context>>()

  register(contribution: ViewContribution<Context>): () => void {
    if (this.views.has(contribution.id)) throw new Error(`View already registered: ${contribution.id}`)
    this.views.set(contribution.id, contribution)
    return () => { if (this.views.get(contribution.id) === contribution) this.views.delete(contribution.id) }
  }

  render(id: string, context: Context): ReactNode {
    const view = this.views.get(id)
    if (!view || (view.module && !context.workspace.modules[view.module])) return null
    return view.render(context)
  }

  has(id: string): boolean { return this.views.has(id) }
}
