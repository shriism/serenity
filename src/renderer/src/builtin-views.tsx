import type { ReadScope, WorkspaceSnapshot, WorkspacePage } from '../../shared/types'
import { CalendarModule, TasksModule } from './module-views'
import { ReviewPanel } from './review-panel'
import { DocumentsPanel } from './documents-panel'
import { DocumentPreview } from './document-preview'
import { DocumentEditor, isEditableDocument } from './document-editor'
import { ActivityPanel } from './activity-panel'
import { WorkspacePageView } from './workspace-page'
import { KnowledgeView } from './knowledge-view'
import { EntityEditor } from './entity-editor'
import { EntityTimeline } from './entity-timeline'
import { SearchView } from './search-view'
import { EntityConnections } from './entity-connections'
import { DocumentKnowledgeView } from './document-knowledge'
import { PageConnections } from './page-connections'
import { presentationFor } from './presentations'
import { resourceUri } from '../../shared/resources'
import type { ActivityItem } from '../../shared/activity'
import { ViewRegistry } from './view-registry'
import type { EditorContext } from './markdown-editor'

export interface BuiltinViewContext {
  workspace: WorkspaceSnapshot
  /** The page shown, for page tabs. */
  page?: WorkspacePage
  entityId?: string
  activeDocument?: string
  /** How the shown resource is presented, if not its default view. */
  presentation?: string
  editor: EditorContext
  focusedEventId: string | null
  focusedTaskId: string | null
  focusVersion: number
  activity: ActivityItem[]
  taskPresentation: 'list' | 'board'
  onTaskPresentationChange(presentation: 'list' | 'board'): void
  calendarPresentation: 'month' | 'agenda'
  onCalendarPresentationChange(presentation: 'month' | 'agenda'): void
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
  onOpenResource(uri: string, side?: boolean): void
  onResolve(id: string, accept: boolean): void
  onAttach(id: string, entityId: string): void
  onOpenSource(name: string): void
  onImport(): void
  onNewDocument(): void
  onOpenDocument(name: string): void
  onAnalyze(name: string): void
  onOpenEntity(id: string): void
  onNewEntity(): void
  onDiscuss(question: string): void
  /** A new conversation that may read only the given entities and documents. */
  onAsk(prompt: string, scope: Pick<ReadScope, 'entityIds' | 'documentNames'>): void
  /** Query to start a Search view with, e.g. carried over from the search palette. */
  searchQuery: string
}

export const builtinViews = new ViewRegistry<BuiltinViewContext>()
builtinViews.register({ id: 'knowledge', render: (context) => {
  if (!context.entityId) return <KnowledgeView workspace={context.workspace} onOpenEntity={context.onOpenEntity} onNewEntity={context.onNewEntity}
    onOpenInPane={(id, side) => context.onOpenResource(resourceUri({ kind: 'entity', id }), side)}/>
  const entityId = context.entityId
  // A tab can outlive its file for a moment (deleted elsewhere) before the workbench prunes it.
  if (!context.workspace.entities.some((entity) => entity.id === entityId)) return null
  const presentation = presentationFor('entity', context.presentation)
  if (presentation === 'timeline') return <EntityTimeline workspace={context.workspace} entityId={entityId} onOpenResource={context.onOpenResource} onOpenSource={context.onOpenSource}/>
  if (presentation === 'connections') return <EntityConnections workspace={context.workspace} entityId={entityId}
    onOpenEntity={(id, side) => context.onOpenResource(resourceUri({ kind: 'entity', id }), side)} onOpenResource={(uri, side) => context.onOpenResource(uri, side)}/>
  return <EntityEditor key={entityId} workspace={context.workspace} entityId={entityId} context={context.editor} onUpdate={context.onUpdate} onError={context.onError}
    onOpenEntity={context.onOpenEntity} onDiscuss={context.onDiscuss} onOpenSource={context.onOpenSource}/>
} })
builtinViews.register({ id: 'home', render: (context) => {
  if (!context.page) return null
  if (presentationFor('page', context.presentation) === 'links') return <PageConnections page={context.page} workspace={context.workspace} onOpen={context.onOpenResource}/>
  return <WorkspacePageView key={context.page.id} page={context.page} workspace={context.workspace} context={context.editor} onUpdate={context.onUpdate} onError={context.onError}/>
} })
builtinViews.register({ id: 'calendar', module: 'calendar', render: ({ workspace, onUpdate, onError, focusedEventId, focusVersion, calendarPresentation, onCalendarPresentationChange, onOpenResource }) =>
  <CalendarModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusEventId={focusedEventId} focusVersion={focusVersion}
    calendarPresentation={calendarPresentation} onCalendarPresentationChange={onCalendarPresentationChange} onOpenResource={onOpenResource}/> })
builtinViews.register({ id: 'tasks', module: 'tasks', render: ({ workspace, onUpdate, onError, focusedTaskId, focusVersion, taskPresentation, onTaskPresentationChange }) =>
  <TasksModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusTaskId={focusedTaskId} focusVersion={focusVersion}
    taskPresentation={taskPresentation} onTaskPresentationChange={onTaskPresentationChange}/> })
builtinViews.register({ id: 'review', render: ({ workspace, onResolve, onAttach, onOpenSource, onOpenResource, onUpdate, onError }) =>
  <ReviewPanel workspace={workspace} onResolve={onResolve} onAttach={onAttach} onOpenSource={onOpenSource} onOpenResource={(uri, side) => onOpenResource(uri, side)}
    onUpdate={onUpdate} onError={onError}/> })
builtinViews.register({ id: 'documents', render: ({ workspace, activeDocument, onImport, onNewDocument, onOpenDocument, onOpenSource, onError, onAnalyze, onResolve, onAttach, presentation, onOpenResource, onAsk, editor, onUpdate }) =>
  activeDocument ? presentationFor('document', presentation) === 'knowledge'
    ? <DocumentKnowledgeView name={activeDocument} workspace={workspace} onOpenResource={(uri, side) => onOpenResource(uri, side)} onAsk={onAsk}/>
    : isEditableDocument(activeDocument)
      ? <DocumentEditor key={activeDocument} name={activeDocument} workspace={workspace} context={editor} onUpdate={onUpdate} onError={onError} onOpen={onOpenSource}
          onReview={() => onOpenResource('serenity:view/review')}/>
      : <DocumentPreview name={activeDocument} workspace={workspace} onOpen={onOpenSource} onError={onError} onResolve={onResolve} onAttach={onAttach} onOpenSource={onOpenSource}/>
    : <DocumentsPanel workspace={workspace} onImport={onImport} onNew={onNewDocument} onOpen={onOpenDocument} onAnalyze={onAnalyze}/> })
builtinViews.register({ id: 'search', render: ({ workspace, searchQuery, onOpenResource, onAsk }) =>
  <SearchView workspace={workspace} initialQuery={searchQuery} onOpenResource={(uri, side) => onOpenResource(uri, side)} onAsk={onAsk}/> })
builtinViews.register({ id: 'activity', render: ({ workspace, activity, onOpenResource }) => <ActivityPanel workspace={workspace} activity={activity} onOpenResource={(uri, side) => onOpenResource(uri, side)}/> })
// Settings is a dialog, but stays a registered view so its command and availability keep working.
builtinViews.register({ id: 'settings', render: () => null })
