import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  chatGPTUsageURL, compatiblePresets, providerIds, providerLabels, type ModelOption, type ProviderId, type ProviderSettings, type ProviderStatus
} from '../../shared/providers'
import { Dialog } from './dialog'

type Statuses = Record<ProviderId, ProviderStatus>

function statusLabel(provider: ProviderId, status: ProviderStatus | undefined): string {
  if (!status) return 'Checking…'
  switch (status.state) {
    case 'ready': return provider === 'openai-compatible' ? `Connected${status.account ? ` · ${status.account}` : ''}`
      : status.account ? `Signed in as ${status.account}` : status.credential === 'token' ? 'Token saved' : 'Signed in'
    case 'needs-permission': return 'Plan usage not allowed'
    case 'signed-out': return provider === 'openai-compatible' ? 'Needs an API key' : 'Not signed in'
    case 'not-configured': return 'Not set up'
    default: return provider === 'openai-compatible' ? 'Not reachable' : 'Could not check'
  }
}

/** Chooses the model a provider uses; the list comes from the provider for the signed-in account or configured server. */
function ModelChoice({ provider, status, settings, onChange, onError }: { provider: ProviderId; status?: ProviderStatus; settings: ProviderSettings
  onChange(model: string | null): void; onError(message: string): void }) {
  const [models, setModels] = useState<ModelOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const ready = status?.state === 'ready'
  const selected = settings[provider].model ?? ''
  const baseURL = provider === 'openai-compatible' ? settings['openai-compatible'].baseURL : undefined
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
      <option value="">{loading ? 'Loading models…' : provider === 'copilot' ? 'Copilot default' : 'First available model'}</option>
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
  const [copied, setCopied] = useState(false)
  const [copilotToken, setCopilotToken] = useState('')
  const [apiKey, setApiKey] = useState('')
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
    void window.serenity.providerSettings().then((next) => { setSettings(next); setBaseURL(next['openai-compatible'].baseURL ?? '') }, (error) => reportError(String(error)))
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
      if (change.baseURL !== undefined) { setBaseURL(next['openai-compatible'].baseURL ?? ''); refresh() }
    } catch (error) { onError(String(error)) }
  }
  function saveKey(event: FormEvent, provider: ProviderId, value: string, clear: () => void): void {
    event.preventDefault()
    void act(provider, () => window.serenity.saveCredential(provider, value)).then((next) => { if (next) clear() })
  }
  function copyLogin(command: string): void {
    window.serenity.copyText(command)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => { setCopied(false); copyTimer.current = null }, 2000)
  }
  const manageUsage = <button type="button" className="secondary" onClick={() => void window.serenity.openExternal(chatGPTUsageURL)}>Manage usage</button>
  const models = (provider: ProviderId): ReactNode => settings && <ModelChoice provider={provider} status={statuses?.[provider]} settings={settings}
    onChange={(model) => void saveSetting({ provider, model })} onError={reportError}/>
  const chatgpt = statuses?.chatgpt
  const copilot = statuses?.copilot
  const compatible = statuses?.['openai-compatible']

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
        <button type="button" className="secondary" onClick={() => copyLogin('copilot login')} aria-label={copied ? 'copilot login command copied' : 'Copy copilot login command'}>
          {copied ? <><Check size={14} aria-hidden="true"/> Copied</> : 'Copy command'}</button></div>}
      <form onSubmit={(event) => saveKey(event, 'copilot', copilotToken, () => setCopilotToken(''))}>
        <label className="field-label" htmlFor="copilot-token">{copilot?.credential === 'token' ? 'Replace the saved GitHub token' : 'Or add a GitHub token'}</label>
        <div className="provider-key-row"><input id="copilot-token" type="password" autoComplete="off" value={copilotToken}
          onChange={(event) => setCopilotToken(event.target.value)} placeholder="Fine-grained or OAuth token with Copilot access"/>
          <button type="submit" className="primary" disabled={!copilotToken.trim() || busy !== null}>Save</button></div>
        {copilot?.credential === 'token' && <button type="button" className="text-button provider-remove" disabled={busy !== null}
          onClick={() => void act('copilot', () => window.serenity.saveCredential('copilot', ''))}>Remove saved token</button>}
      </form>
    </ProviderCard>

    <ProviderCard provider="openai-compatible" status={compatible}>
      <p>Connect a local model runtime or any server that offers the OpenAI-compatible API. Workspace context is sent to the server you enter.</p>
      <form onSubmit={(event) => { event.preventDefault(); void saveSetting({ provider: 'openai-compatible', baseURL }) }}>
        <label className="field-label" htmlFor="compatible-preset">Server</label>
        <select id="compatible-preset" value={compatiblePresets.find((item) => item.baseURL === baseURL)?.id ?? ''}
          onChange={(event) => { const preset = compatiblePresets.find((item) => item.id === event.target.value); if (preset) setBaseURL(preset.baseURL) }}>
          <option value="">Custom</option>
          {compatiblePresets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <label className="field-label" htmlFor="compatible-url">Base URL</label>
        <div className="provider-key-row"><input id="compatible-url" type="url" spellCheck={false} value={baseURL} onChange={(event) => setBaseURL(event.target.value)}
          placeholder="http://127.0.0.1:11434/v1"/>
          <button type="submit" className="primary" disabled={busy !== null || baseURL.trim() === (settings?.['openai-compatible'].baseURL ?? '')}>Save</button></div>
      </form>
      {compatible?.detail && <p className="hint">{compatible.detail}</p>}
      {models('openai-compatible')}
      <form onSubmit={(event) => saveKey(event, 'openai-compatible', apiKey, () => setApiKey(''))}>
        <label className="field-label" htmlFor="compatible-key">{compatible?.credential === 'api-key' ? 'Replace the saved API key' : 'API key (if the server needs one)'}</label>
        <div className="provider-key-row"><input id="compatible-key" type="password" autoComplete="off" value={apiKey}
          onChange={(event) => setApiKey(event.target.value)} placeholder="Local runtimes usually need none"/>
          <button type="submit" className="primary" disabled={!apiKey.trim() || busy !== null}>Save</button></div>
        {compatible?.credential === 'api-key' && <button type="button" className="text-button provider-remove" disabled={busy !== null}
          onClick={() => void act('openai-compatible', () => window.serenity.saveCredential('openai-compatible', ''))}>Remove saved key</button>}
      </form>
    </ProviderCard>

    {welcome && <Dialog title="You’re using your ChatGPT plan" onClose={() => setWelcome(false)}
      footer={<button type="button" className="primary" onClick={() => setWelcome(false)}>Got it</button>}>
      <p>Eligible usage in Serenity uses your ChatGPT plan. Manage usage in your ChatGPT settings.</p>
    </Dialog>}
  </>
}

export const providerOptions = providerIds.map((id) => ({ id, label: providerLabels[id] }))
