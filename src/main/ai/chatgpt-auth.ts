import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKey } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { cancelled, ProviderError } from './model-provider'

/**
 * Sign in with ChatGPT for open-source, locally run apps, as documented at
 * https://developers.openai.com/siwc/token-sharing-open-source: a public OAuth client registered per account on first
 * sign-in, PKCE, a 127.0.0.1 loopback redirect, and tokens scoped to the public Responses API.
 */
export const openAIAuth = {
  issuer: 'https://auth.openai.com',
  authorize: 'https://auth.openai.com/api/accounts/authorize',
  token: 'https://auth.openai.com/api/accounts/oauth/token',
  revoke: 'https://auth.openai.com/api/accounts/oauth/revoke',
  jwks: 'https://auth.openai.com/.well-known/jwks.json',
  resource: 'https://api.openai.com/v1',
  /** The first-time registration entry point; never saved or used for a token exchange. */
  registrationClient: 'dynamic_agent_client',
  scopes: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  planScope: 'chatgpt.tokens.use.direct',
  callbackPath: '/auth/callback',
  preferredPort: 1455
} as const

export const agentName = 'Serenity'

const base64url = (buffer: Buffer): string => buffer.toString('base64url')

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export const randomToken = (): string => base64url(randomBytes(32))
export const newHostId = (): string => `urn:uuid:${randomUUID()}`

export interface AuthorizeOptions {
  /** The saved issued client id for a returning account; omitted for a new registration. */
  clientId?: string
  redirectUri: string
  hostId: string
  state: string
  nonce: string
  challenge: string
  idTokenHint?: string
  loginHint?: string
  /** Asks again for permissions the person declined earlier. */
  consent?: boolean
}

export function authorizeURL(options: AuthorizeOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId ?? openAIAuth.registrationClient,
    ...(options.clientId ? {} : { agent_name_hint: agentName }),
    ext_agent_host_id: options.hostId,
    ...(options.idTokenHint ? { id_token_hint: options.idTokenHint } : {}),
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
    response_type: 'code',
    redirect_uri: options.redirectUri,
    scope: openAIAuth.scopes,
    resource: openAIAuth.resource,
    state: options.state,
    nonce: options.nonce,
    code_challenge_method: 'S256',
    code_challenge: options.challenge,
    ...(options.consent ? { prompt: 'consent' } : {})
  })
  return `${openAIAuth.authorize}?${params}`
}

export interface Callback { code?: string; state?: string; clientId?: string; error?: string; errorDescription?: string }

const page = (title: string, detail: string): string => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#333">
<div style="text-align:center"><h1 style="font-size:20px">${title}</h1><p>${detail}</p></div></body>`

/**
 * Listens on 127.0.0.1 for the one browser redirect of a sign-in attempt. The documented port is tried first; only
 * the port may change between attempts, so another free port is used when it is taken.
 */
export async function listenForCallback(signal?: AbortSignal, timeout = 10 * 60_000): Promise<{ redirectUri: string; result: Promise<Callback>; close(): void }> {
  let resolveResult!: (value: Callback) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<Callback>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== openAIAuth.callbackPath) { response.writeHead(404).end(); return }
    const params = url.searchParams
    const callback: Callback = {
      ...(params.get('code') ? { code: params.get('code')! } : {}),
      ...(params.get('state') ? { state: params.get('state')! } : {}),
      ...(params.get('client_id') ? { clientId: params.get('client_id')! } : {}),
      ...(params.get('error') ? { error: params.get('error')! } : {}),
      ...(params.get('error_description') ? { errorDescription: params.get('error_description')! } : {})
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(callback.error ? page('Sign-in was not completed', 'You can close this tab and return to Serenity.')
      : page('Signed in', 'You can close this tab and return to Serenity.'))
    resolveResult(callback)
  })
  const listen = (port: number): Promise<number> => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve((server.address() as { port: number }).port) })
  })
  let port: number
  try { port = await listen(openAIAuth.preferredPort) }
  catch { port = await listen(0) }
  const timer = setTimeout(() => rejectResult(new ProviderError('Sign-in timed out. Try again.', 'timeout')), timeout)
  const abort = (): void => rejectResult(cancelled())
  signal?.addEventListener('abort', abort, { once: true })
  const close = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); server.close(); server.closeAllConnections() }
  void result.finally(close).catch(() => undefined)
  if (signal?.aborted) abort()
  return { redirectUri: `http://127.0.0.1:${port}${openAIAuth.callbackPath}`, result, close }
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

/** Posts a form-encoded grant to the token endpoint. Errors keep the OAuth error code for recovery decisions. */
export async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<TokenResponse> {
  const response = await fetcher(openAIAuth.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) as Record<string, unknown> } catch { /* Reported below. */ }
  if (!response.ok || typeof data.access_token !== 'string') {
    const code = typeof data.error === 'string' ? data.error : typeof (data.error as { code?: unknown })?.code === 'string' ? (data.error as { code: string }).code : undefined
    const description = typeof data.error_description === 'string' ? data.error_description : undefined
    throw new ProviderError(`ChatGPT sign-in failed (${response.status}${code ? `, ${code}` : ''})${description ? `: ${description}` : ''}`, code, response.status)
  }
  return data as unknown as TokenResponse
}

export interface VerifiedIdentity { subject: string; email?: string }

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
}

const algorithms: Record<string, { hash: string; ec?: boolean }> = {
  RS256: { hash: 'sha256' }, RS384: { hash: 'sha384' }, RS512: { hash: 'sha512' },
  ES256: { hash: 'sha256', ec: true }, ES384: { hash: 'sha384', ec: true }
}

/** Verifies an ID token's signature against OpenAI's published keys, then its issuer, audience, lifetime, and nonce. */
export async function verifyIdToken(token: string, expected: { clientId: string; nonce: string },
  keys: () => Promise<JsonWebKey[]>, now = Date.now()): Promise<VerifiedIdentity> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('The ID token is malformed')
  const header = decodePart(parts[0])
  const claims = decodePart(parts[1])
  const algorithm = typeof header.alg === 'string' ? algorithms[header.alg] : undefined
  if (!algorithm) throw new Error(`Unsupported ID token algorithm ${String(header.alg)}`)
  const candidates = (await keys()).filter((key) => !header.kid || key.kid === header.kid)
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`)
  const signature = Buffer.from(parts[2], 'base64url')
  const valid = candidates.some((key) => {
    try {
      return verify(algorithm.hash, signed, { key: createPublicKey({ key, format: 'jwk' }), ...(algorithm.ec ? { dsaEncoding: 'ieee-p1363' as const } : {}) }, signature)
    } catch { return false }
  })
  if (!valid) throw new Error('The ID token signature could not be verified')
  if (claims.iss !== openAIAuth.issuer) throw new Error('The ID token has an unexpected issuer')
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audience.includes(expected.clientId)) throw new Error('The ID token was issued for another client')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new Error('The ID token has expired')
  if (claims.nonce !== expected.nonce) throw new Error('The ID token does not match this sign-in')
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('The ID token has no subject')
  return { subject: claims.sub, ...(typeof claims.email === 'string' ? { email: claims.email } : {}) }
}

export async function fetchKeys(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<JsonWebKey[]> {
  const response = await fetcher(openAIAuth.jwks, { signal })
  if (!response.ok) throw new Error(`Could not load OpenAI's signing keys (${response.status})`)
  const body = await response.json() as { keys?: unknown }
  return Array.isArray(body.keys) ? body.keys as JsonWebKey[] : []
}

/** Refresh failures after which the saved token set can never work again. */
export const unusableRefreshCodes = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])

export const grantedScopes = (scope: string | undefined): string[] => (scope ?? '').split(/\s+/).filter(Boolean).sort()
