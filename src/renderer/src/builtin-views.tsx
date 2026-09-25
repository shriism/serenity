import type { WorkspaceSnapshot, WorkspacePage } from '../../shared/types'
import { CalendarModule, TasksModule } from './module-views'
import { ReviewPanel } from './review-panel'
import { DocumentsPanel } from './documents-panel'
import { DocumentPreview } from './document-preview'
import { ActivityPanel } from './activity-panel'
import { SettingsPanel } from './settings-panel'
import { WorkspacePageView } from './workspace-page'
import { KnowledgeView, type KnowledgeViewProps } from './knowledge-view'
import type { CommandContribution } from './commands'
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
  knowledge: KnowledgeViewProps
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
  onDirtyChange(dirty: boolean): void
  onOpenResource(uri: string): void
  onCommand(id: string): void
  onResolve(id: string, accept: boolean): void
  onAttach(id: string, entityId: string): void
  onOpenSource(name: string): void
  onImport(): void
  onOpenDocument(name: string): void
  onAnalyze(name: string): void
}

export const builtinViews = new ViewRegistry<BuiltinViewContext>()
builtinViews.register({ id: 'knowledge', render: ({ knowledge }) => <KnowledgeView {...knowledge}/> })
builtinViews.register({ id: 'home', render: (context) => context.page ? <WorkspacePageView key={context.page.id} page={context.page} workspace={context.workspace}
  commands={context.commands} onUpdate={context.onUpdate} onError={context.onError} onDirtyChange={context.onDirtyChange}
  onOpen={context.onOpenResource} onCommand={context.onCommand}/> :
  <section className="page"><h1>Home page unavailable</h1><p>Check the configured page in this workspace. Serenity will not replace a page it cannot read.</p></section> })
builtinViews.register({ id: 'calendar', module: 'calendar', render: ({ workspace, onUpdate, onError, focusedEventId, focusVersion }) =>
  <CalendarModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusEventId={focusedEventId} focusVersion={focusVersion}/> })
builtinViews.register({ id: 'tasks', module: 'tasks', render: ({ workspace, onUpdate, onError, focusedTaskId, focusVersion }) =>
  <TasksModule workspace={workspace} onUpdate={onUpdate} onError={onError} focusTaskId={focusedTaskId} focusVersion={focusVersion}/> })
builtinViews.register({ id: 'review', render: ({ workspace, onResolve, onAttach, onOpenSource }) =>
  <ReviewPanel workspace={workspace} onResolve={onResolve} onAttach={onAttach} onOpenSource={onOpenSource}/> })
builtinViews.register({ id: 'documents', render: ({ workspace, activeDocument, onImport, onOpenDocument, onOpenSource, onError, onAnalyze }) =>
  activeDocument ? <DocumentPreview name={activeDocument} onOpen={onOpenSource} onError={onError}/> :
    <DocumentsPanel workspace={workspace} onImport={onImport} onOpen={onOpenDocument} onAnalyze={onAnalyze}/> })
builtinViews.register({ id: 'activity', render: ({ workspace, activity }) => <ActivityPanel workspace={workspace} activity={activity}/> })
builtinViews.register({ id: 'settings', render: ({ workspace, onUpdate, onError }) => <SettingsPanel workspace={workspace} onUpdate={onUpdate} onError={onError}/> })
