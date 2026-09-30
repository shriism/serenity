import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  chatGPTUsageURL, defaultOllamaURL, providerIds, providerLabels, type ModelOption, type ProviderId, type ProviderSettings, type ProviderStatus
} from '../../shared/providers'
import { Dialog } from './dialog'

type Statuses = Record<ProviderId, ProviderStatus>

function statusLabel(provider: ProviderId, status: ProviderStatus | undefined): string {
  if (!status) return 'Checking…'
  switch (status.state) {
    case 'ready': return provider === 'ollama' ? 'Running'
      : status.account ? `Signed in as ${status.account}` : status.credential === 'token' ? 'Token saved' : 'Signed in'
    case 'needs-permission': return 'Plan usage not allowed'
    case 'signed-out': return 'Not signed in'
    case 'not-configured': return provider === 'ollama' ? 'No models installed' : 'Not set up'
    default: return provider === 'ollama' ? 'Not running' : 'Could not check'
  }
}

/** Chooses the model a provider uses; the list comes from the provider for the signed-in account or configured server. */
function ModelChoice({ provider, status, settings, onChange, onError }: { provider: ProviderId; status?: ProviderStatus; settings: ProviderSettings
  onChange(model: string | null): void; onError(message: string): void }) {
  const [models, setModels] = useState<ModelOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const ready = status?.state === 'ready'
  const selected = settings[provider].model ?? ''
  const baseURL = provider === 'ollama' ? settings.ollama.baseURL : undefined
  useEffect(() => {
    if (!ready) { setModels(null); return }
    let current = true
    setLoading(true)
    window.serenity.providerModels(provider).then((items) => { if (current) setModels(items) })
      .catch((error) => { if (current) { setModels([]); onError(String(error)) } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [provider, ready, baseURL, status?.account, onError])
  if (!ready) return null
  const options = models ?? []
  const known = !selected || options.some((item) => item.id === selected)
  return <div className="provider-model">
    <label className="field-label" htmlFor={`${provider}-model`}>Model</label>
    <select id={`${provider}-model`} value={selected} disabled={loading} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{loading ? 'Loading models…' : provider === 'copilot' ? 'Copilot default' : provider === 'ollama' ? 'First installed model' : 'First available model'}</option>
      {!known && <option value={selected}>{selected}</option>}
      {options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </div>
}

function ProviderCard({ provider, status, children }: { provider: ProviderId; status?: ProviderStatus; children: ReactNode }) {
  return <details className="provider-card">
    <summary className="provider-card-heading"><h3>{providerLabels[provider]}</h3>
      <span className={status?.state === 'ready' ? 'provider-saved' : 'provider-unchecked'}>{statusLabel(provider, status)}</span>
      <ChevronDown size={16} aria-hidden="true"/></summary>
    <div className="provider-card-content">{children}</div>
  </details>
}

/** Sign-in, keys, endpoints, and model choices for each AI provider. Credentials stay with the app, never in a workspace. */
export function AIProviderSettings({ onError }: { onError(message: string): void }) {
  const [statuses, setStatuses] = useState<Statuses | null>(null)
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState<ProviderId | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [copilotToken, setCopilotToken] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef(0)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const reportError = useCallback((message: string) => onErrorRef.current(message), [])

  const refresh = useCallback((): void => {
    const current = ++request.current
    setChecking(true)
    void window.serenity.providerStatus().then((next) => { if (request.current === current) setStatuses(next) })
      .catch((error) => { if (request.current === current) reportError(String(error)) })
      .finally(() => { if (request.current === current) setChecking(false) })
  }, [reportError])
  useEffect(() => {
    refresh()
    void window.serenity.providerSettings().then((next) => { setSettings(next); setBaseURL(next.ollama.baseURL ?? defaultOllamaURL) }, (error) => reportError(String(error)))
    window.addEventListener('focus', refresh)
    return () => { ++request.current; window.removeEventListener('focus', refresh); if (copyTimer.current) clearTimeout(copyTimer.current) }
  }, [refresh, reportError])

  /** Runs an action that returns fresh statuses, ignoring any status check it overtakes. */
  async function act(provider: ProviderId, work: () => Promise<Statuses>): Promise<Statuses | null> {
    ++request.current
    setChecking(false)
    setBusy(provider)
    try { const next = await work(); setStatuses(next); onError(''); return next }
    catch (error) { if (!/cancelled/i.test(String(error))) onError(String(error)); return null }
    finally { setBusy(null) }
  }
  async function signIn(newAccount = false): Promise<void> {
    setSigningIn(true)
    try {
      const next = await act('chatgpt', () => window.serenity.providerSignIn('chatgpt', newAccount))
      if (next?.chatgpt.firstPlanUse) setWelcome(true)
    } finally { setSigningIn(false) }
  }
  async function saveSetting(change: Parameters<typeof window.serenity.updateProviderSettings>[0]): Promise<void> {
    try {
      const next = await window.serenity.updateProviderSettings(change)
      setSettings(next)
      onError('')
      if (change.baseURL !== undefined) { setBaseURL(next.ollama.baseURL ?? defaultOllamaURL); refresh() }
    } catch (error) { onError(String(error)) }
  }
  function saveKey(event: FormEvent, provider: ProviderId, value: string, clear: () => void): void {
    event.preventDefault()
    void act(provider, () => window.serenity.saveCredential(provider, value)).then((next) => { if (next) clear() })
  }
  function copyCommand(command: string): void {
    window.serenity.copyText(command)
    setCopied(command)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => { setCopied(null); copyTimer.current = null }, 2000)
  }
  const manageUsage = <button type="button" className="secondary" onClick={() => void window.serenity.openExternal(chatGPTUsageURL)}>Manage usage</button>
  const models = (provider: ProviderId): ReactNode => settings && <ModelChoice provider={provider} status={statuses?.[provider]} settings={settings}
    onChange={(model) => void saveSetting({ provider, model })} onError={reportError}/>
  const chatgpt = statuses?.chatgpt
  const copilot = statuses?.copilot
  const ollama = statuses?.ollama
  const savedURL = settings?.ollama.baseURL ?? defaultOllamaURL

  return <>
    <div className="provider-intro"><p className="hint">Choose a provider for each conversation in the assistant. Serenity sends only the context it shows you, and reviews every suggested change.</p>
      <button type="button" className="text-button" disabled={checking || busy !== null} onClick={refresh}>{checking ? 'Checking…' : 'Check again'}</button></div>

    <ProviderCard provider="chatgpt" status={chatgpt}>
      {signingIn ? <>
        <p>Finish signing in with ChatGPT in your browser, then return here.</p>
        <div className="form-buttons"><button type="button" className="secondary" onClick={() => void window.serenity.cancelProviderSignIn('chatgpt')}>Cancel</button></div>
      </> : chatgpt?.state === 'ready' ? <>
        <p>ChatGPT plan usage is enabled{chatgpt.account ? ` for ${chatgpt.account}` : ''}. Requests from Serenity count toward your plan’s usage.</p>
        {models('chatgpt')}
        <div className="form-buttons">{manageUsage}
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => void signIn(true)}>Use another account</button>
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => void act('chatgpt', () => window.serenity.providerSignOut('chatgpt'))}>Sign out</button></div>
        {chatgpt.detail && <p className="hint">{chatgpt.detail}</p>}
      </> : chatgpt?.state === 'needs-permission' ? <>
        <p>You’re signed in{chatgpt.account ? ` as ${chatgpt.account}` : ''}, but Serenity isn’t allowed to use your ChatGPT plan. Allow it to send requests, or use another provider.</p>
        <div className="form-buttons">
          <button type="button" className="primary" disabled={busy !== null} onClick={() => void signIn()}>Allow ChatGPT plan usage</button>
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => void act('chatgpt', () => window.serenity.providerSignOut('chatgpt'))}>Sign out</button></div>
      </> : <>
        <p>Use your ChatGPT plan in Serenity. Eligible requests use the usage included in your ChatGPT plan or credits, which you can manage in ChatGPT settings.</p>
        {chatgpt?.detail && <p className="hint">{chatgpt.detail}</p>}
        <div className="form-buttons"><button type="button" className="primary" disabled={busy !== null || !chatgpt} onClick={() => void signIn()}>Continue with ChatGPT</button></div>
      </>}
    </ProviderCard>

    <ProviderCard provider="copilot" status={copilot}>
      <p>{copilot?.state === 'ready' ? 'Your GitHub Copilot subscription is available to Serenity.' :
        'Uses your GitHub Copilot subscription. Sign in with the Copilot command-line app, then check again, or add a GitHub token below.'}</p>
      {copilot?.detail && <p className="hint">{copilot.detail}</p>}
      {copilot?.state === 'ready' && models('copilot')}
      {copilot?.state !== 'ready' && <div className="provider-login"><code>copilot login</code>
        <button type="button" className="secondary" onClick={() => copyCommand('copilot login')} aria-label={copied === 'copilot login' ? 'copilot login command copied' : 'Copy copilot login command'}>
          {copied === 'copilot login' ? <><Check size={14} aria-hidden="true"/> Copied</> : 'Copy command'}</button></div>}
      <form onSubmit={(event) => saveKey(event, 'copilot', copilotToken, () => setCopilotToken(''))}>
        <label className="field-label" htmlFor="copilot-token">{copilot?.credential === 'token' ? 'Replace the saved GitHub token' : 'Or add a GitHub token'}</label>
        <div className="provider-key-row"><input id="copilot-token" type="password" autoComplete="off" value={copilotToken}
          onChange={(event) => setCopilotToken(event.target.value)} placeholder="Fine-grained or OAuth token with Copilot access"/>
          <button type="submit" className="primary" disabled={!copilotToken.trim() || busy !== null}>Save</button></div>
        {copilot?.credential === 'token' && <button type="button" className="text-button provider-remove" disabled={busy !== null}
          onClick={() => void act('copilot', () => window.serenity.saveCredential('copilot', ''))}>Remove saved token</button>}
      </form>
    </ProviderCard>

    <ProviderCard provider="ollama" status={ollama}>
      <p>Runs models with Ollama on this computer, or on another machine you choose. Workspace context goes only to that Ollama server.</p>
      {ollama?.state === 'unavailable' && <p className="hint">Ollama isn’t running at {ollama.account ?? savedURL}. <button type="button" className="text-button"
        onClick={() => void window.serenity.openExternal('https://ollama.com/download')}>Download Ollama</button> or start it, then check again.</p>}
      {ollama?.state === 'not-configured' && <><p className="hint">Ollama is running but has no models yet. Download one, then check again:</p>
        <div className="provider-login"><code>ollama pull gemma3</code>
          <button type="button" className="secondary" onClick={() => copyCommand('ollama pull gemma3')}>{copied === 'ollama pull gemma3' ? <><Check size={14} aria-hidden="true"/> Copied</> : 'Copy command'}</button></div></>}
      {models('ollama')}
      <form onSubmit={(event) => { event.preventDefault(); void saveSetting({ provider: 'ollama', baseURL: baseURL.trim() === defaultOllamaURL ? '' : baseURL }) }}>
        <label className="field-label" htmlFor="ollama-url">Server address</label>
        <div className="provider-key-row"><input id="ollama-url" type="url" spellCheck={false} value={baseURL} onChange={(event) => setBaseURL(event.target.value)}
          placeholder={defaultOllamaURL}/>
          <button type="submit" className="primary" disabled={busy !== null || !baseURL.trim() || baseURL.trim() === savedURL}>Save</button></div>
        {savedURL !== defaultOllamaURL && <button type="button" className="text-button provider-remove" disabled={busy !== null}
          onClick={() => void saveSetting({ provider: 'ollama', baseURL: '' })}>Use this computer’s Ollama</button>}
      </form>
    </ProviderCard>

    {welcome && <Dialog title="You’re using your ChatGPT plan" onClose={() => setWelcome(false)}
      footer={<button type="button" className="primary" onClick={() => setWelcome(false)}>Got it</button>}>
      <p>Eligible usage in Serenity uses your ChatGPT plan. Manage usage in your ChatGPT settings.</p>
    </Dialog>}
  </>
}

export const providerOptions = providerIds.map((id) => ({ id, label: providerLabels[id] }))
