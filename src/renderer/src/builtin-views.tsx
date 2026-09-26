import type { WorkspaceSnapshot, WorkspacePage } from '../../shared/types'
import { CalendarModule, TasksModule } from './module-views'
import { ReviewPanel } from './review-panel'
import { DocumentsPanel } from './documents-panel'
import { DocumentPreview } from './document-preview'
import { ActivityPanel } from './activity-panel'
import { SettingsPanel } from './settings-panel'
import { WorkspacePageView } from './workspace-page'
import { KnowledgeView } from './knowledge-view'
import { EntityEditor } from './entity-editor'
import { EntityTimeline } from './entity-timeline'
import { EntityConnections } from './entity-connections'
import { PresentationSwitcher, presentationFor } from './presentations'
import type { CommandContribution } from './commands'
import { resourceUri } from '../../shared/resources'
import { ViewRegistry } from './view-registry'

export interface BuiltinViewContext {
  workspace: WorkspaceSnapshot
  page?: WorkspacePage
  commands: CommandContribution[]
  activeDocument?: string
  focusedEventId: string | null
  focusedTaskId: string | null
  focusVersion: number
  activity: { id: string; at: string; title: string; detail: string }[]
  entityId?: string
  creatingEntity: boolean
  /** How the shown resource is presented, if not its default view. */
  presentation?: string
  onPresentationChange(id: string): void
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
  onDirtyChange(dirty: boolean): void
  onOpenResource(uri: string, side?: boolean): void
  onCommand(id: string): void
  onResolve(id: string, accept: boolean): void
  onAttach(id: string, entityId: string): void
  onOpenSource(name: string): void
  onImport(): void
  onOpenDocument(name: string): void
  onAnalyze(name: string): void
  onOpenEntity(id: string): void
  onNewEntity(): void
  onEntityCreated(id: string): void
  onDiscuss(question: string): void
}

export const builtinViews = new ViewRegistry<BuiltinViewContext>()
const entityEditor = (context: BuiltinViewContext) => <EntityEditor key={context.entityId ?? 'new'} workspace={context.workspace} entityId={context.entityId ?? null}
  onUpdate={context.onUpdate} onError={context.onError} onDirtyChange={context.onDirtyChange} onOpenEntity={context.onOpenEntity} onNewEntity={context.onNewEntity}
  onCreated={context.onEntityCreated} onDiscuss={context.onDiscuss} onOpenSource={context.onOpenSource}/>
builtinViews.register({ id: 'knowledge', render: (context) => {
  if (!context.entityId) return context.creatingEntity ? entityEditor(context) :
    <KnowledgeView workspace={context.workspace} onOpenEntity={context.onOpenEntity} onNewEntity={context.onNewEntity}/>
  const entityId = context.entityId
  const presentation = presentationFor('entity', context.presentation)!
  return <div className="presented-resource">
    <PresentationSwitcher kind="entity" active={presentation} onChange={context.onPresentationChange}/>
    {presentation === 'timeline' ? <EntityTimeline workspace={context.workspace} entityId={entityId} onOpenResource={context.onOpenResource} onOpenSource={context.onOpenSource}/> :
      presentation === 'connections' ? <EntityConnections workspace={context.workspace} entityId={entityId}
        onOpenEntity={(id, side) => context.onOpenResource(resourceUri({ kind: 'entity', id }), side)}/> : entityEditor(context)}
  </div>
} })
builtinViews.register({ id: 'home', render: (context) => context.page ? <WorkspacePageView key={context.page.id} page={context.page} workspace={context.workspace}
  commands={context.commands} onUpdate={context.onUpdate} onError={context.onError} onDirtyChange={context.onDirtyChange}
  onOpen={context.onOpenResource} onCommand={context.onCommand}/> :
  <section className="page"><h1>Home page unavailable</h1><p>Check the configured page in this workspace. Serenity will not replace a page it cannot read.</p></section> })
builtinViews.register({ id: 'calendar', module: 'calendar', render: ({ workspace, onUpdate, onError, focusedEventId, focusVersion }) =>
  <CalendarModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusEventId={focusedEventId} focusVersion={focusVersion}/> })
builtinViews.register({ id: 'tasks', module: 'tasks', render: ({ workspace, onUpdate, onError, focusedTaskId, focusVersion }) =>
  <TasksModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusTaskId={focusedTaskId} focusVersion={focusVersion}/> })
builtinViews.register({ id: 'review', render: ({ workspace, onResolve, onAttach, onOpenSource, onOpenResource, onUpdate, onError }) =>
  <ReviewPanel workspace={workspace} onResolve={onResolve} onAttach={onAttach} onOpenSource={onOpenSource} onOpenResource={(uri, side) => onOpenResource(uri, side)}
    onUpdate={onUpdate} onError={onError}/> })
builtinViews.register({ id: 'documents', render: ({ workspace, activeDocument, onImport, onOpenDocument, onOpenSource, onError, onAnalyze, onResolve, onAttach }) =>
  activeDocument ? <DocumentPreview name={activeDocument} workspace={workspace} onOpen={onOpenSource} onError={onError} onResolve={onResolve} onAttach={onAttach} onOpenSource={onOpenSource}/> :
    <DocumentsPanel workspace={workspace} onImport={onImport} onOpen={onOpenDocument} onAnalyze={onAnalyze}/> })
builtinViews.register({ id: 'activity', render: ({ workspace, activity }) => <ActivityPanel workspace={workspace} activity={activity}/> })
builtinViews.register({ id: 'settings', render: ({ workspace, onUpdate, onError }) => <SettingsPanel workspace={workspace} onUpdate={onUpdate} onError={onError}/> })
