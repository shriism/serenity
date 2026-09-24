import { MessageCircle, Plus, Settings2 } from 'lucide-react'
import type { Autonomy, Conversation, ReadScope, WorkflowPermissions, WorkspaceSnapshot } from '../../shared/types'

interface Props {
  workspace: WorkspaceSnapshot
  conversationId: string | null
  autonomy: Autonomy
  permissions: WorkflowPermissions
  readScope: ReadScope
  busy: boolean
  onNew(): void
  onSelect(conversation: Conversation): void
  onPermissionsChange(permissions: WorkflowPermissions): void
  onReadScopeChange(scope: ReadScope): void
  onSaveSettings(): void
}

export function ConversationList(props: Props) {
  return <aside className="conversation-list">
    <div className="conversation-list-heading">
      <button className="icon-button" title="New conversation" aria-label="New conversation" onClick={props.onNew} disabled={props.busy}><Plus size={15}/><span>New chat</span></button>
    </div>
    <details className="thread-switcher"><summary>History <span>{props.workspace.conversations.length}</span></summary>
    <nav className="conversation-history-list" aria-label="Conversations">
      {props.workspace.conversations.map((item) => <button key={item.id} className={props.conversationId === item.id ? 'active' : ''}
        disabled={props.busy} onClick={() => props.onSelect(item)}>
        <span className="thread-icon"><MessageCircle size={15}/></span>
        <span><strong>{item.title}</strong><small>{item.messages.length} messages {item.retained ? '' : '· not retained'}</small></span>
      </button>)}
      {!props.workspace.conversations.length && <p className="hint">Questions and ideas you explore together will show up here.</p>}
    </nav></details>
    <details className="conversation-workflow">
      <summary title="Conversation settings" aria-label="Conversation settings"><Settings2 size={16}/><span>Settings</span></summary>
      <div className="conversation-workflow-body">
        {props.autonomy === 'autonomous' && <div className="workflow-scope"><span className="eyebrow">MAY AUTO-SAVE</span>
          {([
            ['claims', 'Sourced claims'], ['entities', 'Existing-category entities'], ['tasks', 'Tasks'], ['events', 'Calendar events']
          ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={props.permissions[key]}
            onChange={(event) => props.onPermissionsChange({ ...props.permissions, [key]: event.target.checked })}/>{label}</label>)}
          <small>New categories and ambiguous identities always require review.</small>
        </div>}
        <div className="read-scope"><span className="eyebrow">WHAT AI MAY READ</span>
          <select aria-label="AI read scope" value={props.readScope.mode} onChange={(event) => props.onReadScopeChange({ ...props.readScope, mode: event.target.value as ReadScope['mode'] })}>
            <option value="workspace">Entire workspace</option><option value="selected">Selected knowledge</option>
          </select>
          {props.readScope.mode === 'selected' && <div className="read-scope-items">
            <strong>Entities</strong>
            {props.workspace.entities.map((entity) => <label key={entity.id}><input type="checkbox" checked={props.readScope.entityIds.includes(entity.id)}
              onChange={(event) => props.onReadScopeChange({ ...props.readScope, entityIds: event.target.checked ? [...props.readScope.entityIds, entity.id] : props.readScope.entityIds.filter((id) => id !== entity.id) })}/>{entity.title}</label>)}
            <strong>Documents</strong>
            {props.workspace.documents.map((document) => <label key={document.name}><input type="checkbox" checked={props.readScope.documentNames.includes(document.name)}
              onChange={(event) => props.onReadScopeChange({ ...props.readScope, documentNames: event.target.checked ? [...props.readScope.documentNames, document.name] : props.readScope.documentNames.filter((name) => name !== document.name) })}/>{document.name}</label>)}
            <label><input type="checkbox" checked={props.readScope.includeOtherConversations} onChange={(event) => props.onReadScopeChange({ ...props.readScope, includeOtherConversations: event.target.checked })}/>Other conversations</label>
            <label><input type="checkbox" checked={props.readScope.includeCalendarAndTasks} onChange={(event) => props.onReadScopeChange({ ...props.readScope, includeCalendarAndTasks: event.target.checked })}/>Calendar and tasks</label>
          </div>}
          <small>Current conversation messages are included. Background AI has separate workspace settings.</small>
        </div>
        {props.conversationId ? <button className="workflow-save" onClick={props.onSaveSettings}>Save workflow settings</button> : <small className="workflow-hint">Settings for a new conversation are saved with your first message.</small>}
      </div>
    </details>
  </aside>
}
