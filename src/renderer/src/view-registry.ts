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

  available(id: string, context: Pick<Context, 'workspace'>): boolean {
    const view = this.views.get(id)
    return Boolean(view && (!view.module || context.workspace.modules[view.module]))
  }

  render(id: string, context: Context): ReactNode {
    const view = this.views.get(id)
    return view && this.available(id, context) ? view.render(context) : null
  }

  has(id: string): boolean { return this.views.has(id) }
}
