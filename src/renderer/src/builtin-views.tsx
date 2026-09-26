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
import { DocumentKnowledgeView } from './document-knowledge'
import { PresentationSwitcher, presentationFor } from './presentations'
import type { CommandContribution } from './commands'
import { resourceUri } from '../../shared/resources'
import type { ActivityItem } from '../../shared/activity'
import { ViewRegistry } from './view-registry'

export interface BuiltinViewContext {
  workspace: WorkspaceSnapshot
  page?: WorkspacePage
  commands: CommandContribution[]
  shortcuts: { id: string; title: string; keys?: string }[]
  activeDocument?: string
  focusedEventId: string | null
  focusedTaskId: string | null
  focusVersion: number
  activity: ActivityItem[]
  entityId?: string
  creatingEntity: boolean
  /** How the shown resource is presented, if not its default view. */
  presentation?: string
  onPresentationChange(id: string): void
  taskPresentation: 'list' | 'board'
  onTaskPresentationChange(presentation: 'list' | 'board'): void
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
  onCreated={context.onEntityCreated} onDiscuss={context.onDiscuss} onOpenSource={context.onOpenSource} onOpenResource={(uri, side) => context.onOpenResource(uri, side)}/>
builtinViews.register({ id: 'knowledge', render: (context) => {
  if (!context.entityId) return context.creatingEntity ? entityEditor(context) :
    <KnowledgeView workspace={context.workspace} onOpenEntity={context.onOpenEntity} onNewEntity={context.onNewEntity}
      onOpenInPane={(id, side) => context.onOpenResource(resourceUri({ kind: 'entity', id }), side)}/>
  const entityId = context.entityId
  const presentation = presentationFor('entity', context.presentation)!
  return <div className="presented-resource">
    <PresentationSwitcher kind="entity" active={presentation} onChange={context.onPresentationChange}/>
    {presentation === 'timeline' ? <EntityTimeline workspace={context.workspace} entityId={entityId} onOpenResource={context.onOpenResource} onOpenSource={context.onOpenSource}/> :
      presentation === 'connections' ? <EntityConnections workspace={context.workspace} entityId={entityId}
        onOpenEntity={(id, side) => context.onOpenResource(resourceUri({ kind: 'entity', id }), side)} onOpenResource={(uri, side) => context.onOpenResource(uri, side)}/> : entityEditor(context)}
  </div>
} })
builtinViews.register({ id: 'home', render: (context) => context.page ? <WorkspacePageView key={context.page.id} page={context.page} workspace={context.workspace}
  commands={context.commands} onUpdate={context.onUpdate} onError={context.onError} onDirtyChange={context.onDirtyChange}
  onOpen={context.onOpenResource} onCommand={context.onCommand}/> :
  <section className="page"><h1>Home page unavailable</h1><p>Check the configured page in this workspace. Serenity will not replace a page it cannot read.</p></section> })
builtinViews.register({ id: 'calendar', module: 'calendar', render: ({ workspace, onUpdate, onError, focusedEventId, focusVersion }) =>
  <CalendarModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusEventId={focusedEventId} focusVersion={focusVersion}/> })
builtinViews.register({ id: 'tasks', module: 'tasks', render: ({ workspace, onUpdate, onError, focusedTaskId, focusVersion, taskPresentation, onTaskPresentationChange }) =>
  <TasksModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusTaskId={focusedTaskId} focusVersion={focusVersion}
    taskPresentation={taskPresentation} onTaskPresentationChange={onTaskPresentationChange}/> })
builtinViews.register({ id: 'review', render: ({ workspace, onResolve, onAttach, onOpenSource, onOpenResource, onUpdate, onError }) =>
  <ReviewPanel workspace={workspace} onResolve={onResolve} onAttach={onAttach} onOpenSource={onOpenSource} onOpenResource={(uri, side) => onOpenResource(uri, side)}
    onUpdate={onUpdate} onError={onError}/> })
builtinViews.register({ id: 'documents', render: ({ workspace, activeDocument, onImport, onOpenDocument, onOpenSource, onError, onAnalyze, onResolve, onAttach, presentation, onPresentationChange, onOpenResource }) =>
  activeDocument ? <div className="presented-resource">
    <PresentationSwitcher kind="document" active={presentationFor('document', presentation)!} onChange={onPresentationChange}/>
    {presentationFor('document', presentation) === 'knowledge' ? <DocumentKnowledgeView name={activeDocument} workspace={workspace} onOpenResource={(uri, side) => onOpenResource(uri, side)}/> :
      <DocumentPreview name={activeDocument} workspace={workspace} onOpen={onOpenSource} onError={onError} onResolve={onResolve} onAttach={onAttach} onOpenSource={onOpenSource}/>}
  </div> :
    <DocumentsPanel workspace={workspace} onImport={onImport} onOpen={onOpenDocument} onAnalyze={onAnalyze}/> })
builtinViews.register({ id: 'activity', render: ({ workspace, activity, onOpenResource }) => <ActivityPanel workspace={workspace} activity={activity} onOpenResource={(uri, side) => onOpenResource(uri, side)}/> })
builtinViews.register({ id: 'settings', render: ({ workspace, shortcuts, onUpdate, onError }) => <SettingsPanel workspace={workspace} shortcuts={shortcuts} onUpdate={onUpdate} onError={onError}/> })
