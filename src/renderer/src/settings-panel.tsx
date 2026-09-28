import { useEffect, useState, type FormEvent } from 'react'
import { Blocks, Info, Keyboard, Palette, PenLine, Sparkles } from 'lucide-react'
import { preferences, usePreferences, type Preferences } from './preferences'
import { eventKeybinding } from '../../shared/keybindings'
import type { Provider, WorkspaceSnapshot } from '../../shared/types'
import { modules, type ModuleId } from '../../shared/modules'
import type { ThemePreference } from './theme'
import { Dialog } from './dialog'

const sections = [
  { id: 'general', title: 'General', icon: Palette },
  { id: 'editor', title: 'Editor', icon: PenLine },
  { id: 'modules', title: 'Modules', icon: Blocks },
  { id: 'ai', title: 'AI providers', icon: Sparkles },
  { id: 'shortcuts', title: 'Shortcuts', icon: Keyboard },
  { id: 'about', title: 'About', icon: Info }
] as const
type Section = (typeof sections)[number]['id']

interface Props {
  workspace: WorkspaceSnapshot
  /** Every available command with its current chord, after this workspace's keybindings are applied. */
  shortcuts: { id: string; title: string; keys?: string }[]
  theme: ThemePreference
  onThemeChange(theme: ThemePreference): void
  onChooseWorkspace(): void
  onOpenFolder(): void
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(error: string): void
  onClose(): void
}

/** A shortcut cell that records the next chord pressed and saves it for this workspace. */
function ShortcutRecorder({ id, title, keys, overridden, onSave }: { id: string; title: string; keys?: string; overridden: boolean
  onSave(id: string, chord: string | null | undefined): void }) {
  const [recording, setRecording] = useState(false)
  const mac = navigator.platform.includes('Mac')
  return <div className="shortcut-cell">
    <button type="button" className={`shortcut-button ${recording ? 'recording' : ''}`} aria-label={recording ? `Press the new shortcut for ${title}` : `Change shortcut for ${title}`}
      onClick={() => setRecording(true)} onBlur={() => setRecording(false)}
      onKeyDown={(event) => {
        if (!recording) return
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Escape') { setRecording(false); return }
        if (event.key === 'Backspace' || event.key === 'Delete') { setRecording(false); onSave(id, null); return }
        const chord = eventKeybinding(event, mac)
        if (!chord) return
        setRecording(false)
        onSave(id, chord)
      }}>
      {recording ? 'Press keys…' : keys ? <kbd>{keys}</kbd> : <span className="hint">Add</span>}
    </button>
    {overridden && !recording && <button type="button" className="text-button" onClick={() => onSave(id, undefined)} title="Use the default shortcut">Reset</button>}
  </div>
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange(value: boolean): void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`}
    onClick={() => onChange(!checked)}><span/></button>
}

export function SettingsDialog({ workspace, shortcuts, theme, onThemeChange, onChooseWorkspace, onOpenFolder, onUpdate, onError, onClose }: Props) {
  const [section, setSection] = useState<Section>('general')
  const prefs = usePreferences()
  const [credentials, setCredentials] = useState<Record<Provider, boolean> | null>(null)
  const [keyProvider, setKeyProvider] = useState<Provider>('copilot')
  const [key, setKey] = useState('')
  const [filter, setFilter] = useState('')
  const [about, setAbout] = useState<Awaited<ReturnType<typeof window.serenity.appInfo>> | null>(null)
  useEffect(() => { void window.serenity.appInfo().then(setAbout).catch(() => setAbout(null)) }, [])
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

  const wanted = filter.trim().toLocaleLowerCase()
  const shownShortcuts = [...shortcuts].filter((item) => !wanted || `${item.title} ${item.id}`.toLocaleLowerCase().includes(wanted))
    .sort((a, b) => Number(!a.keys) - Number(!b.keys) || a.title.localeCompare(b.title))
  const name = workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.path

  return <Dialog title="Settings" onClose={onClose} className="settings-dialog" hideTitle>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        {sections.map(({ id, title, icon: Icon }) => <button key={id} type="button" className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined}
          onClick={() => setSection(id)}><Icon size={15}/>{title}</button>)}
      </nav>
      <div className="settings-content">
        {section === 'general' && <section aria-labelledby="settings-general">
          <h2 id="settings-general">General</h2>
          <div className="setting-row"><div><strong>Workspace</strong><small title={workspace.path}>{workspace.path}</small></div>
            <div className="setting-actions"><button className="secondary" onClick={onOpenFolder}>Reveal</button><button className="secondary" onClick={onChooseWorkspace}>Open another…</button></div></div>
          <div className="setting-row"><div><strong>Appearance</strong><small>Dark, light, or follow the system setting.</small></div>
            <div className="segmented" role="radiogroup" aria-label="Appearance">{(['dark', 'light', 'system'] as const).map((option) =>
              <button key={option} type="button" role="radio" aria-checked={theme === option} className={theme === option ? 'active' : ''} onClick={() => onThemeChange(option)}>
                {option === 'system' ? 'System' : option === 'dark' ? 'Dark' : 'Light'}</button>)}</div></div>
          <p className="hint">Everything in “{name}” is ordinary Markdown and YAML you can open and back up with other apps. Workspace settings live in its <code>.serenity</code> folder.</p>
        </section>}
        {section === 'editor' && <section aria-labelledby="settings-editor">
          <h2 id="settings-editor">Editor</h2>
          <p className="hint">These apply on this device, in every workspace.</p>
          {([
            ['escapeLeavesEditing', 'Escape leaves editing', 'Press Esc to stop editing a page or note and read it without Markdown syntax.'],
            ['autoHideScrollbars', 'Hide scrollbars until scrolling', 'Scrollbars appear while you scroll or point at them, instead of always.'],
            ['numberedTabShortcuts', 'Switch tabs with ⌘/Ctrl-1…9', '1–8 go to that tab in the focused pane and 9 to the last one. The shortcuts can also be changed under Shortcuts.']
          ] as [keyof Preferences, string, string][]).map(([key, title, detail]) => <div key={key} className="setting-row">
            <div><strong>{title}</strong><small>{detail}</small></div>
            <Toggle label={title} checked={prefs[key]} onChange={(value) => preferences.set({ [key]: value })}/>
          </div>)}
        </section>}
        {section === 'modules' && <section aria-labelledby="settings-modules">
          <h2 id="settings-modules">Modules</h2>
          <p className="hint">Turning a module off hides it without removing its files. Background AI modules send workspace content to the provider below, so they are off by default.</p>
          {modules.map((item) => <div key={item.id} className="setting-row">
            <div><strong>{item.title}</strong><small>{item.description}</small></div>
            <Toggle label={item.title} checked={workspace.modules[item.id]} disabled={workspace.backgroundProviderNeedsChoice && (item.id === 'semanticIndex' || item.id === 'documentAnalysis')}
              onChange={(enabled) => void toggleModule(item.id, enabled)}/>
          </div>)}
          <div className="setting-row"><div><strong>Background AI provider</strong><small>{workspace.semanticIndex ? `Last indexed ${workspace.semanticIndex.count} records on ${new Date(workspace.semanticIndex.generatedAt).toLocaleString()}` :
            'Used for the index and document analysis.'}</small></div>
            <select id="index-provider" aria-label="Background AI provider" value={workspace.semanticProvider} onChange={(event) => void changeBackgroundProvider(event.target.value as Provider)}>
              <option value="copilot">GitHub Copilot</option><option value="codex">OpenAI Codex</option>
            </select></div>
          {workspace.backgroundProviderNeedsChoice && <div className="callout warning"><span>The previous provider is unavailable, so background AI is paused.</span>
            <button className="secondary" type="button" onClick={() => void changeBackgroundProvider(workspace.semanticProvider)}>Use selected provider</button></div>}
        </section>}
        {section === 'ai' && <section aria-labelledby="settings-ai">
          <h2 id="settings-ai">AI providers</h2>
          <p className="hint">Use an existing provider sign-in where supported, or set an API key or token. Credentials stay outside the workspace, in the system’s secure storage or only for this session.</p>
          {(['copilot', 'codex'] as const).map((provider) => <div key={provider} className="setting-row">
            <div><strong>{provider === 'copilot' ? 'GitHub Copilot' : 'OpenAI Codex'}</strong><small>{credentials?.[provider] ? 'Credential available' : 'Use provider sign-in or add a key'}</small></div>
            <span className={`status-dot ${credentials?.[provider] ? 'on' : ''}`} aria-hidden="true"/>
          </div>)}
          <form className="stacked-form" onSubmit={(event) => void saveKey(event)}>
            <h3>Set a key or token</h3>
            <label className="field-label" htmlFor="key-provider">Provider</label>
            <select id="key-provider" value={keyProvider} onChange={(event) => setKeyProvider(event.target.value as Provider)}>
              <option value="copilot">GitHub token</option><option value="codex">Codex API key</option>
            </select>
            <label className="field-label" htmlFor="provider-key">Credential</label>
            <input id="provider-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste a key or token"/>
            <div className="form-buttons">
              {credentials?.[keyProvider] && <button className="secondary" type="button" onClick={() => void removeKey()}>Remove credential</button>}
              <button className="primary" type="submit" disabled={!key.trim()}>Save</button>
            </div>
          </form>
        </section>}
        {section === 'shortcuts' && <section className="settings-shortcuts" aria-labelledby="shortcuts-heading">
          <h2 id="shortcuts-heading">Shortcuts</h2>
          <p className="hint">Click a shortcut and press new keys to change it for this workspace; Backspace removes it and Esc cancels. Changes are saved in <code>.serenity/workbench.yaml</code>, which you can also edit directly.</p>
          <input className="settings-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter commands" aria-label="Filter commands"/>
          <table>
            <thead><tr><th scope="col">Command</th><th scope="col">Shortcut</th><th scope="col">ID</th></tr></thead>
            <tbody>{shownShortcuts.map((item) => <tr key={item.id}><td>{item.title}</td>
              <td><ShortcutRecorder id={item.id} title={item.title} keys={item.keys} overridden={workspace.workbench.keybindings?.[item.id] !== undefined}
                onSave={(id, chord) => { void window.serenity.setKeybinding(id, chord).then(onUpdate, (error) => onError(String(error))) }}/></td>
              <td><code>{item.id}</code></td></tr>)}</tbody>
          </table>
        </section>}
        {section === 'about' && <section className="settings-about" aria-labelledby="about-heading">
          <h2 id="about-heading">About Serenity</h2>
          {about && <p>Version {about.version} · Electron {about.electron} · Chromium {about.chrome} · {about.platform}</p>}
          <p className="hint">Include this line when reporting a problem. Your workspace stays in the folder you chose; nothing here is sent anywhere.</p>
        </section>}
      </div>
    </div>
  </Dialog>
}
