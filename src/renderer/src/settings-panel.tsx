import { useEffect, useState, type FormEvent } from 'react'
import type { Provider, WorkspaceSnapshot } from '../../shared/types'
import { modules, type ModuleId } from '../../shared/modules'

interface Props {
  workspace: WorkspaceSnapshot
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
}

export function SettingsPanel({ workspace, onUpdate, onError }: Props) {
  const [credentials, setCredentials] = useState<Record<Provider, boolean> | null>(null)
  const [keyProvider, setKeyProvider] = useState<Provider>('copilot')
  const [key, setKey] = useState('')

  useEffect(() => { void window.serenity.credentialStatus().then(setCredentials).catch((error) => onError(String(error))) }, [onError])

  async function toggleModule(id: ModuleId, enabled: boolean): Promise<void> {
    try { onUpdate(await window.serenity.setModule(id, enabled)); onError('') }
    catch (error) { onError(String(error)) }
  }

  async function changeBackgroundProvider(provider: Provider): Promise<void> {
    try { onUpdate(await window.serenity.setSemanticProvider(provider)); onError('') }
    catch (error) { onError(String(error)) }
  }

  async function saveKey(event: FormEvent): Promise<void> {
    event.preventDefault()
    try { setCredentials(await window.serenity.saveCredential(keyProvider, key)); setKey(''); onError('') }
    catch (error) { onError(String(error)) }
  }

  async function removeKey(): Promise<void> {
    try { setCredentials(await window.serenity.saveCredential(keyProvider, '')); onError('') }
    catch (error) { onError(String(error)) }
  }

  return <section className="page">
    <span className="eyebrow">WORKSPACE SETTINGS</span><h1>Modules & connections</h1>
    <p>Turn modules off without removing their files. Calendar and tasks belong to Serenity and connect to the same knowledge workspace. Background AI modules are off by default.</p>
    <div className="document-list">
      {modules.map((item) => <label key={item.id} className="module-toggle"><span>
        <strong>{item.title}</strong><small>{item.description}</small>
      </span><input type="checkbox" checked={workspace.modules[item.id]}
        disabled={workspace.backgroundProviderNeedsChoice && (item.id === 'semanticIndex' || item.id === 'documentAnalysis')}
        onChange={(event) => void toggleModule(item.id, event.target.checked)}/></label>)}
    </div>
    <div className="semantic-settings">
      <label htmlFor="index-provider">Background AI provider (index & document analysis)</label>
      <select id="index-provider" value={workspace.semanticProvider} onChange={(event) => void changeBackgroundProvider(event.target.value as Provider)}>
        <option value="copilot">GitHub Copilot</option><option value="codex">OpenAI Codex</option>
      </select>
      {workspace.backgroundProviderNeedsChoice && <><small>The previous provider is unavailable. Background AI is paused; confirm a supported provider to resume.</small>
        <button className="secondary" type="button" onClick={() => void changeBackgroundProvider(workspace.semanticProvider)}>Use selected provider</button></>}
      <small>{workspace.semanticIndex ? `Last indexed ${workspace.semanticIndex.count} records on ${new Date(workspace.semanticIndex.generatedAt).toLocaleString()}` :
        'No background index yet. Enabling background AI may send workspace content to this provider.'}</small>
    </div>
    <h2>AI providers</h2>
    <p>Use an existing provider sign-in where supported, or set an API key or token. Credentials stay outside the knowledge workspace. On devices without secure OS storage, an entered key is kept only for this app session.</p>
    <div className="document-list">
      {(['copilot', 'codex'] as const).map((provider) => <div key={provider} className="document-row">
        <span>✳</span><strong>{provider === 'copilot' ? 'GitHub Copilot' : 'OpenAI Codex'}</strong>
        <small>{credentials?.[provider] ? 'Credential available' : 'Use provider sign-in or add a key'}</small>
      </div>)}
    </div>
    <form className="connection-form" onSubmit={(event) => void saveKey(event)}>
      <h2>Set an API key or token</h2>
      <label htmlFor="key-provider">Provider</label>
      <select id="key-provider" value={keyProvider} onChange={(event) => setKeyProvider(event.target.value as Provider)}>
        <option value="copilot">GitHub token</option><option value="codex">Codex API key</option>
      </select>
      <label htmlFor="provider-key">Credential</label>
      <input id="provider-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste a key or token"/>
      <div className="review-actions">
        <button className="primary" type="submit" disabled={!key.trim()}>Save securely or for this session</button>
        {credentials?.[keyProvider] && <button className="secondary" type="button" onClick={() => void removeKey()}>Remove credential</button>}
      </div>
    </form>
  </section>
}
