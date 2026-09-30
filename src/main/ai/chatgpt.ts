import type { JsonWebKey } from 'node:crypto'
import type { ModelOption, ProviderStatus } from '../../shared/providers'
import { chatGPTUsageURL } from '../../shared/providers'
import { cancelled, ProviderError, throwIfCancelled, type InferenceOptions, type InferenceRequest, type InferenceResult, type ModelProvider, type SignInOptions } from './model-provider'
import { readResponsesStream, requestSignal, responseError } from './streams'
import type { ProviderStorage } from './storage'
import {
  authorizeURL, createPkce, fetchKeys, grantedScopes, listenForCallback, newHostId, openAIAuth, randomToken, tokenRequest,
  unusableRefreshCodes, verifyIdToken, type TokenResponse
} from './chatgpt-auth'

/** A ChatGPT account registered with this installation. The issued client id is bound to that account and workspace. */
interface Registration { clientId: string; subject?: string; email?: string }
interface AuthState { hostId?: string; registrations?: Registration[]; active?: string; welcomed?: boolean }
interface TokenSet {
  subject: string
  email?: string
  idToken?: string
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scopes: string[]
  savedAt: string
}

export interface ChatGPTDependencies {
  storage: ProviderStorage
  openBrowser(url: string): Promise<void>
  fetch?: typeof fetch
  /** Only for tests, which substitute a local server for OpenAI. */
  apiBase?: string
  keys?: () => Promise<JsonWebKey[]>
}

const stateKey = 'chatgpt'
const tokenKey = (clientId: string): string => `chatgpt:${clientId}`
const service = 'ChatGPT'

function describeError(code: string | undefined, message: string): string {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return `Usage limit reached. Review your plan or Serenity’s limit in ChatGPT settings: ${chatGPTUsageURL}`
    case 'subscription_sharing_user_not_eligible': return 'ChatGPT plan usage isn’t available for this account or workspace.'
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable': return 'ChatGPT couldn’t check plan availability just now. Try again shortly.'
    case 'subscription_sharing_unsupported_capability': return `This request isn’t supported with ChatGPT plan usage (${message}).`
    case 'subscription_sharing_invalid_user': return 'ChatGPT couldn’t validate this account. Sign in again in Settings.'
    default: return message
  }
}

export class ChatGPTProvider implements ModelProvider {
  readonly id = 'chatgpt' as const
  private readonly fetch: typeof fetch
  private readonly api: string
  private refreshing: Promise<TokenSet> | null = null
  private signingIn: AbortController | null = null

  constructor(private readonly deps: ChatGPTDependencies) {
    this.fetch = deps.fetch ?? fetch
    this.api = deps.apiBase ?? openAIAuth.resource
  }

  private async authState(): Promise<AuthState> { return await this.deps.storage.state<AuthState>(stateKey) ?? {} }
  private async saveAuthState(change: (state: AuthState) => void): Promise<AuthState> {
    const state = await this.authState()
    change(state)
    await this.deps.storage.setState(stateKey, state)
    return state
  }

  private async tokens(clientId: string): Promise<TokenSet | undefined> {
    const raw = await this.deps.storage.secret(tokenKey(clientId))
    if (!raw) return undefined
    try { return JSON.parse(raw) as TokenSet } catch { return undefined }
  }

  private async active(): Promise<{ registration: Registration; tokens?: TokenSet } | undefined> {
    const state = await this.authState()
    const registration = state.registrations?.find((item) => item.clientId === state.active)
    return registration ? { registration, tokens: await this.tokens(registration.clientId) } : undefined
  }

  async status(): Promise<ProviderStatus> {
    const current = await this.active()
    if (!current?.tokens) return { state: 'signed-out', credential: 'none' }
    const account = current.tokens.email ?? current.registration.email
    if (!current.tokens.scopes.includes(openAIAuth.planScope)) {
      return { state: 'needs-permission', credential: 'sign-in', ...(account ? { account } : {}),
        detail: 'Signed in, but ChatGPT plan usage was not allowed.' }
    }
    return { state: 'ready', credential: 'sign-in', ...(account ? { account } : {}) }
  }

  /**
   * Opens the system browser for Sign in with ChatGPT. A returning account reuses its issued client id; `newAccount`
   * registers another. When plan usage was declined earlier, consent is requested again.
   */
  async signIn(options: SignInOptions = {}): Promise<ProviderStatus> {
    const { signal } = options
    this.signingIn?.abort()
    const controller = new AbortController()
    this.signingIn = controller
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      let state = await this.authState()
      if (!state.hostId) state = await this.saveAuthState((draft) => { draft.hostId = newHostId() })
      const previous = options.newAccount ? undefined : state.registrations?.find((item) => item.clientId === state.active)
      const previousTokens = previous ? await this.tokens(previous.clientId) : undefined
      const pkce = createPkce()
      const attempt = { state: randomToken(), nonce: randomToken() }
      const listener = await listenForCallback(controller.signal)
      let callback
      try {
        await this.deps.openBrowser(authorizeURL({
          ...(previous ? { clientId: previous.clientId } : {}), redirectUri: listener.redirectUri, hostId: state.hostId!,
          state: attempt.state, nonce: attempt.nonce, challenge: pkce.challenge,
          ...(previousTokens?.idToken ? { idTokenHint: previousTokens.idToken } : {}),
          ...(previous?.email ? { loginHint: previous.email } : {}),
          ...(previousTokens && !previousTokens.scopes.includes(openAIAuth.planScope) ? { consent: true } : {})
        }))
        callback = await listener.result
      } finally { listener.close() }
      if (callback.state !== attempt.state) throw new ProviderError('The sign-in response did not match this attempt. Try again.', 'state_mismatch')
      if (callback.error) {
        throw new ProviderError(callback.error === 'access_denied' ? 'Sign-in was cancelled in the browser.' :
          `ChatGPT sign-in failed: ${callback.errorDescription ?? callback.error}`, callback.error)
      }
      if (!callback.code) throw new ProviderError('ChatGPT did not return an authorization code.', 'missing_code')
      if (previous && callback.clientId && callback.clientId !== previous.clientId) throw new ProviderError('ChatGPT returned a different app registration than expected. Try again.', 'client_mismatch')
      const clientId = previous?.clientId ?? callback.clientId
      if (!clientId || clientId === openAIAuth.registrationClient) throw new ProviderError('ChatGPT did not finish registering Serenity. Try again.', 'registration_incomplete')
      // The issued client id is saved before the exchange, so a failed exchange can be retried with the same registration.
      if (!previous) await this.saveAuthState((draft) => { draft.registrations = [...(draft.registrations ?? []).filter((item) => item.clientId !== clientId), { clientId }] })
      const response = await tokenRequest(new URLSearchParams({
        grant_type: 'authorization_code', client_id: clientId, code: callback.code, code_verifier: pkce.verifier,
        redirect_uri: listener.redirectUri, resource: openAIAuth.resource
      }), this.fetch, controller.signal)
      if (!response.id_token) throw new ProviderError('ChatGPT did not return an ID token.', 'missing_id_token')
      const identity = await verifyIdToken(response.id_token, { clientId, nonce: attempt.nonce }, this.deps.keys ?? (() => fetchKeys(this.fetch, controller.signal)))
      if (previous?.subject && previous.subject !== identity.subject) throw new ProviderError('You signed in to a different ChatGPT account. Use “Use another account” to add it.', 'account_mismatch')
      await this.storeTokens(clientId, response, identity)
      const wasWelcomed = Boolean(state.welcomed)
      const saved = await this.saveAuthState((draft) => {
        draft.registrations = [...(draft.registrations ?? []).filter((item) => item.clientId !== clientId),
          { clientId, subject: identity.subject, ...(identity.email ? { email: identity.email } : {}) }]
        draft.active = clientId
      })
      const status = await this.status()
      if (status.state === 'ready' && !wasWelcomed) {
        await this.deps.storage.setState(stateKey, { ...saved, welcomed: true })
        return { ...status, firstPlanUse: true }
      }
      return status
    } finally {
      signal?.removeEventListener('abort', abort)
      if (this.signingIn === controller) this.signingIn = null
    }
  }

  cancelSignIn(): void { this.signingIn?.abort() }

  private async storeTokens(clientId: string, response: TokenResponse, identity: { subject: string; email?: string }, previous?: TokenSet): Promise<TokenSet> {
    const tokens: TokenSet = {
      subject: identity.subject, ...(identity.email ? { email: identity.email } : {}),
      ...(response.id_token ?? previous?.idToken ? { idToken: response.id_token ?? previous?.idToken } : {}),
      accessToken: response.access_token,
      ...(response.refresh_token ?? previous?.refreshToken ? { refreshToken: response.refresh_token ?? previous?.refreshToken } : {}),
      expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
      scopes: response.scope ? grantedScopes(response.scope) : previous?.scopes ?? [],
      savedAt: new Date().toISOString()
    }
    await this.deps.storage.setSecret(tokenKey(clientId), JSON.stringify(tokens))
    return tokens
  }

  /** Ends the renewable session at OpenAI, then clears this account's tokens. The registration is kept for next time. */
  async signOut(): Promise<ProviderStatus> {
    const current = await this.active()
    let confirmed = true
    if (current?.tokens?.refreshToken) {
      confirmed = false
      for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
        try {
          const response = await this.fetch(openAIAuth.revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: current.tokens.refreshToken, token_type_hint: 'refresh_token', client_id: current.registration.clientId }) })
          if (response.ok) confirmed = true
          else if (response.status < 500) break
        } catch { /* Retried below. */ }
        if (!confirmed) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
    if (current) await this.deps.storage.setSecret(tokenKey(current.registration.clientId), undefined)
    return { state: 'signed-out', credential: 'none',
      ...(confirmed ? {} : { detail: 'Signed out here, but OpenAI did not confirm ending the session. You can disconnect Serenity in ChatGPT settings.' }) }
  }

  /** A current access token, refreshed near expiry. Refreshes are serialized because each one rotates the refresh token. */
  private async accessToken(force = false): Promise<{ token: string; clientId: string }> {
    const current = await this.active()
    if (!current?.tokens) throw new ProviderError('Sign in with ChatGPT in Settings to use this provider.', 'signed_out')
    if (!current.tokens.scopes.includes(openAIAuth.planScope)) throw new ProviderError('ChatGPT plan usage is not enabled. Allow it in Settings.', 'plan_not_enabled')
    const { registration, tokens } = current
    if (!force && tokens.expiresAt - Date.now() > 5 * 60_000) return { token: tokens.accessToken, clientId: registration.clientId }
    if (!tokens.refreshToken) throw new ProviderError('Your ChatGPT sign-in has expired. Sign in again in Settings.', 'expired')
    this.refreshing ??= (async () => {
      try {
        const response = await tokenRequest(new URLSearchParams({
          grant_type: 'refresh_token', client_id: registration.clientId, refresh_token: tokens.refreshToken!, resource: openAIAuth.resource
        }), this.fetch)
        return await this.storeTokens(registration.clientId, response, { subject: tokens.subject, ...(tokens.email ? { email: tokens.email } : {}) }, tokens)
      } catch (error) {
        if (error instanceof ProviderError && error.code && unusableRefreshCodes.has(error.code)) {
          await this.deps.storage.setSecret(tokenKey(registration.clientId), undefined)
          throw new ProviderError('Your ChatGPT sign-in has ended. Sign in again in Settings.', error.code)
        }
        if (error instanceof ProviderError && error.code === 'invalid_client') throw new ProviderError('ChatGPT no longer recognizes this app registration. Use “Use another account” to register again.', error.code)
        throw error
      } finally { this.refreshing = null }
    })()
    const refreshed = await this.refreshing
    return { token: refreshed.accessToken, clientId: registration.clientId }
  }

  /** Sends a request with the account's token, refreshing once if the token was rejected before its recorded expiry. */
  private async authorized(path: string, init: RequestInit): Promise<Response> {
    let { token } = await this.accessToken()
    const send = (bearer: string): Promise<Response> => this.fetch(`${this.api}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${bearer}` } })
    let response = await send(token)
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined)
      token = (await this.accessToken(true)).token
      response = await send(token)
    }
    return response
  }

  async listModels(signal?: AbortSignal): Promise<ModelOption[]> {
    const response = await this.authorized('/models', { signal })
    if (!response.ok) throw await responseError(response, service)
    const body = await response.json() as { models?: { slug?: unknown; display_name?: unknown; visibility?: unknown }[]; data?: { id?: unknown }[] }
    if (Array.isArray(body.models)) {
      return body.models.filter((item) => item.visibility === undefined || item.visibility === 'list')
        .flatMap((item) => typeof item.slug === 'string' ? [{ id: item.slug, label: typeof item.display_name === 'string' ? item.display_name : item.slug }] : [])
    }
    return Array.isArray(body.data) ? body.data.flatMap((item) => typeof item.id === 'string' ? [{ id: item.id, label: item.id }] : []) : []
  }

  async generate(request: InferenceRequest, options: InferenceOptions = {}): Promise<InferenceResult> {
    throwIfCancelled(options.signal)
    const model = request.model ?? (await this.deps.storage.settings()).chatgpt.model ?? (await this.listModels(options.signal))[0]?.id
    if (!model) throw new ProviderError('No ChatGPT models are available for this account.', 'no_models')
    const limit = requestSignal(options.signal, 5 * 60_000)
    try {
      // The plan-usage route requires store:false and stream:true, instructions instead of system messages, and the full context in each request.
      const response = await this.authorized('/responses', {
        method: 'POST', signal: limit.signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ model, instructions: request.instructions, input: [{ role: 'user', content: request.input }], store: false, stream: true })
      })
      if (!response.ok) {
        const error = await responseError(response, service)
        throw error.code ? new ProviderError(`${service}: ${describeError(error.code, error.message)}`, error.code, error.status) : error
      }
      if (!response.body) throw new ProviderError(`${service} returned an empty response.`)
      const result = await readResponsesStream(response.body, { ...options, signal: limit.signal }, service, describeError)
      return { text: result.text, model: result.model ?? model }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled()
      if (limit.timedOut()) throw new ProviderError(`${service} took too long to respond.`, 'timeout')
      throw error
    } finally { limit.done() }
  }
}
