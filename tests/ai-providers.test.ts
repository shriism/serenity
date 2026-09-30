import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type JsonWebKey } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamedAnswer } from '../src/shared/streamed-answer'
import { normalizeBaseURL, providerName } from '../src/shared/providers'
import { readChatCompletionsStream, readResponsesStream, serverEvents } from '../src/main/ai/streams'
import { authorizeURL, createPkce, verifyIdToken } from '../src/main/ai/chatgpt-auth'
import { ChatGPTProvider } from '../src/main/ai/chatgpt'
import { OpenAICompatibleProvider } from '../src/main/ai/openai-compatible'
import { ProviderRegistry } from '../src/main/ai/registry'
import { fileProviderStorage, type SecretCipher } from '../src/main/ai/storage'
import type { ModelProvider } from '../src/main/ai/model-provider'
import { Workspace } from '../src/main/workspace'

const streamOf = (...chunks: string[]): ReadableStream<Uint8Array> => new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close() }
})

/** Marks values as "encrypted" so tests can tell they never reach disk in plain text. */
const cipher: SecretCipher = { available: () => true, encrypt: (value) => `enc:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.slice(4), 'base64').toString() }

async function withDirectory<T>(work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-ai-'))
  try { return await work(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

async function listen(handler: (request: IncomingMessage, body: string, response: import('node:http').ServerResponse) => void): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => handler(request, body, response))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server }
}

test('a streamed JSON answer is shown as far as it has arrived, and plain text as written', () => {
  assert.equal(streamedAnswer('{"answer":"Sam was born on Sep'), 'Sam was born on Sep')
  assert.equal(streamedAnswer('{"answer":"Line one\\nLine \\"two\\" \\u00e9', ), 'Line one\nLine "two" é')
  assert.equal(streamedAnswer('{"answer":"Ends mid escape \\'), 'Ends mid escape ')
  assert.equal(streamedAnswer('{"answer":"Done.","citations":[]}'), 'Done.')
  assert.equal(streamedAnswer('```json\n{"citations":[],"ans'), '')
  assert.equal(streamedAnswer('Plain text reply'), 'Plain text reply')
})

test('server-sent events are framed across chunk boundaries, CRLF, multi-line data, and a missing final blank line', async () => {
  const events = []
  for await (const event of serverEvents(streamOf('event: a\r', '\ndata: one\r\n\r\ndata: two\ndata: lines\n\n: comment\n', 'data: last'))) events.push(event)
  assert.deepEqual(events, [{ event: 'a', data: 'one' }, { data: 'two\nlines' }, { data: 'last' }])
})

test('Responses streams succeed only on response.completed and explain plan-usage errors', async () => {
  const deltas: string[] = []
  const done = await readResponsesStream(streamOf(
    'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n', 'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
    'data: {"type":"response.completed","response":{"model":"gpt-test","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}]}}\n\n'
  ), { onText: (delta) => deltas.push(delta) }, 'ChatGPT')
  assert.deepEqual(done, { text: 'Hello', model: 'gpt-test' })
  assert.deepEqual(deltas, ['Hel', 'lo'])
  await assert.rejects(readResponsesStream(streamOf('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'), {}, 'ChatGPT'), /ended the response before it was complete/)
  await assert.rejects(readResponsesStream(streamOf('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"limit"}}}\n\n'),
    {}, 'ChatGPT', (code, message) => code === 'subscription_sharing_usage_limit_exceeded' ? 'Usage limit reached' : message), (error: Error & { code?: string }) =>
    error.code === 'subscription_sharing_usage_limit_exceeded' && /Usage limit reached/.test(error.message))
  await assert.rejects(readResponsesStream(streamOf('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n'), {}, 'ChatGPT'), /max_output_tokens/)
})

test('Chat Completions streams collect deltas and tolerate servers that omit [DONE] after finishing', async () => {
  const chunk = (content: string, finish: string | null = null): string => `data: ${JSON.stringify({ model: 'llama3', choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`
  assert.deepEqual(await readChatCompletionsStream(streamOf(chunk('Hi'), chunk(' there'), 'data: [DONE]\n\n'), {}, 'Server'), { text: 'Hi there', model: 'llama3' })
  assert.deepEqual(await readChatCompletionsStream(streamOf(chunk('Hi'), chunk('', 'stop')), {}, 'Server'), { text: 'Hi', model: 'llama3' })
  await assert.rejects(readChatCompletionsStream(streamOf(chunk('Hi')), {}, 'Server'), /before it was complete/)
  await assert.rejects(readChatCompletionsStream(streamOf('data: {"error":{"message":"model not found"}}\n\n'), {}, 'Server'), /model not found/)
})

test('base URLs are limited to plain http(s) endpoints, and retired providers keep readable names', () => {
  assert.equal(normalizeBaseURL(' http://127.0.0.1:11434/v1/ '), 'http://127.0.0.1:11434/v1')
  assert.throws(() => normalizeBaseURL('file:///etc/passwd'), /http/)
  assert.throws(() => normalizeBaseURL('https://user:secret@example.com/v1'), /API key/)
  assert.throws(() => normalizeBaseURL('not a url'), /full URL/)
  assert.equal(providerName('codex'), 'Codex')
  assert.equal(providerName('chatgpt'), 'ChatGPT')
})

test('the OpenAI-compatible provider streams from a configured server, sends a key only when set, and cancels', async () => withDirectory(async (directory) => {
  const requests: { path: string; auth?: string; body: string }[] = []
  let hold: (() => void) | null = null
  const { url, server } = await listen((request, body, response) => {
    requests.push({ path: request.url!, ...(request.headers.authorization ? { auth: request.headers.authorization } : {}), body })
    if (request.url === '/v1/models') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'llama3' }, { id: 'qwen' }] })); return }
    const parsed = JSON.parse(body) as { model: string; messages: { content: string }[] }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (parsed.messages[1].content === 'wait') { response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Thinking' } }] })}\n\n`); hold = () => response.end(); return }
    response.end(`data: ${JSON.stringify({ model: parsed.model, choices: [{ delta: { content: 'Answer' } }] })}\n\ndata: [DONE]\n\n`)
  })
  try {
    const storage = fileProviderStorage(directory, cipher)
    const provider = new OpenAICompatibleProvider(storage)
    assert.equal((await provider.status()).state, 'not-configured')
    await storage.updateSettings((settings) => { settings['openai-compatible'].baseURL = `${url}/v1` })
    assert.deepEqual(await provider.listModels(), [{ id: 'llama3', label: 'llama3' }, { id: 'qwen', label: 'qwen' }])
    assert.equal((await provider.status()).state, 'ready')
    const deltas: string[] = []
    const result = await provider.generate({ instructions: 'Rules', input: 'Question' }, { onText: (delta) => deltas.push(delta) })
    assert.deepEqual(result, { text: 'Answer', model: 'llama3' }, 'the first listed model is used when none is chosen')
    assert.deepEqual(deltas, ['Answer'])
    const sent = JSON.parse(requests.at(-1)!.body)
    assert.deepEqual(sent.messages, [{ role: 'system', content: 'Rules' }, { role: 'user', content: 'Question' }])
    assert.equal(sent.stream, true)
    assert.ok(requests.every((item) => !item.auth), 'no key is sent before one is saved')
    await provider.setCredential('local-key')
    await provider.generate({ instructions: 'Rules', input: 'Question', model: 'qwen' })
    assert.equal(requests.at(-1)!.auth, 'Bearer local-key')
    assert.equal(JSON.parse(requests.at(-1)!.body).model, 'qwen')
    const stored = await readFile(join(directory, 'provider-credentials.json'), 'utf8')
    assert.ok(!stored.includes('local-key'), 'the key is stored encrypted')

    const controller = new AbortController()
    const pending = provider.generate({ instructions: 'Rules', input: 'wait' }, { signal: controller.signal, onText: () => controller.abort() })
    await assert.rejects(pending, /cancelled/)
    hold?.()

    await storage.updateSettings((settings) => { settings['openai-compatible'].baseURL = 'http://192.0.2.10:8000/v1' })
    await assert.rejects(provider.generate({ instructions: 'Rules', input: 'Question' }), /https/, 'a key is never sent over plain HTTP to another machine')
  } finally { server.close(); server.closeAllConnections() }
}))

// A stand-in for OpenAI's authorization server, JWKS, and Responses API, using a real RSA key and the loopback redirect.
function fakeOpenAI() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' } as JsonWebKey
  const state = { issued: 0, refreshes: 0, revoked: [] as string[], authorizations: [] as URL[], responses: [] as Record<string, unknown>[],
    scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke', expiresIn: 3600, subject: 'user-1', nonce: '' }
  const idToken = (clientId: string): string => {
    const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
    const body = `${part({ alg: 'RS256', kid: 'test-key' })}.${part({ iss: 'https://auth.openai.com', aud: clientId, sub: state.subject,
      email: 'person@example.com', nonce: state.nonce, exp: Math.floor(Date.now() / 1000) + 3600 })}`
    return `${body}.${sign('sha256', Buffer.from(body), privateKey).toString('base64url')}`
  }
  const fetcher = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const form = new URLSearchParams(String(init?.body ?? ''))
    if (url.href === 'https://auth.openai.com/api/accounts/oauth/token') {
      if (form.get('grant_type') === 'refresh_token') {
        state.refreshes++
        if (form.get('refresh_token') === 'dead') return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      const clientId = form.get('client_id')!
      state.issued++
      return Response.json({ access_token: `access-${state.issued}`, refresh_token: `refresh-${state.issued}`, id_token: idToken(clientId),
        token_type: 'Bearer', expires_in: state.expiresIn, scope: state.scope })
    }
    if (url.href === 'https://auth.openai.com/api/accounts/oauth/revoke') { state.revoked.push(form.get('token')!); return new Response(null, { status: 200 }) }
    if (url.pathname === '/v1/models') return Response.json({ models: [{ slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' }] })
    if (url.pathname === '/v1/responses') {
      state.responses.push({ ...JSON.parse(String(init!.body)), authorization: new Headers(init!.headers).get('authorization') })
      return new Response(streamOf('data: {"type":"response.output_text.delta","delta":"Hi"}\n\n', 'data: {"type":"response.completed","response":{"model":"gpt-test","output":[]}}\n\n'))
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  // Plays the person's browser: records the authorization request, then follows the redirect back to Serenity.
  const openBrowser = async (value: string): Promise<void> => {
    const url = new URL(value)
    state.authorizations.push(url)
    state.nonce = url.searchParams.get('nonce')!
    const redirect = new URL(url.searchParams.get('redirect_uri')!)
    redirect.search = new URLSearchParams({ code: 'code-1', state: url.searchParams.get('state')!, scope: state.scope,
      ...(url.searchParams.get('client_id') === 'dynamic_agent_client' ? { client_id: 'oaiapp_registered' } : {}) }).toString()
    setTimeout(() => void fetch(redirect).catch(() => undefined), 10)
  }
  return { state, fetcher, openBrowser, keys: async () => [jwk], idToken }
}

test('Sign in with ChatGPT registers once, verifies identity, streams Responses requests, refreshes, and signs out', async () => withDirectory(async (directory) => {
  const openai = fakeOpenAI()
  const storage = fileProviderStorage(directory, cipher)
  const provider = new ChatGPTProvider({ storage, openBrowser: openai.openBrowser, fetch: openai.fetcher, keys: openai.keys, apiBase: 'https://api.test/v1' })
  assert.equal((await provider.status()).state, 'signed-out')
  const first = await provider.signIn()
  assert.deepEqual({ state: first.state, account: first.account, firstPlanUse: first.firstPlanUse }, { state: 'ready', account: 'person@example.com', firstPlanUse: true })
  const registration = openai.state.authorizations[0].searchParams
  assert.equal(registration.get('client_id'), 'dynamic_agent_client')
  assert.equal(registration.get('agent_name_hint'), 'Serenity')
  assert.equal(registration.get('resource'), 'https://api.openai.com/v1')
  assert.match(registration.get('ext_agent_host_id')!, /^urn:uuid:/)
  assert.match(registration.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
  assert.ok(registration.get('scope')!.split(' ').includes('chatgpt.tokens.use.direct'))

  const settings = await readFile(join(directory, 'ai-providers.json'), 'utf8')
  assert.ok(!settings.includes('access-') && !settings.includes('refresh-'), 'tokens never appear in the plain settings file')
  assert.ok(settings.includes('oaiapp_registered'), 'the issued client id is kept for later sign-ins')

  assert.deepEqual(await provider.listModels(), [{ id: 'gpt-test', label: 'GPT Test' }])
  const deltas: string[] = []
  const answer = await provider.generate({ instructions: 'Rules', input: 'Question' }, { onText: (delta) => deltas.push(delta) })
  assert.deepEqual(answer, { text: 'Hi', model: 'gpt-test' })
  assert.deepEqual(deltas, ['Hi'])
  const sent = openai.state.responses.at(-1)!
  assert.deepEqual({ store: sent.store, stream: sent.stream, instructions: sent.instructions, model: sent.model, authorization: sent.authorization },
    { store: false, stream: true, instructions: 'Rules', model: 'gpt-test', authorization: 'Bearer access-1' })
  assert.deepEqual(sent.input, [{ role: 'user', content: 'Question' }])

  // An access token near expiry is refreshed before use, and the rotated refresh token replaces the old one.
  openai.state.expiresIn = 60
  await provider.signOut()
  await provider.signIn()
  const returning = openai.state.authorizations.at(-1)!.searchParams
  assert.equal(returning.get('client_id'), 'oaiapp_registered', 'a returning account reuses its issued client id')
  assert.equal(returning.get('agent_name_hint'), null)
  assert.equal(returning.get('login_hint'), 'person@example.com')
  assert.equal(returning.get('ext_agent_host_id'), registration.get('ext_agent_host_id'), 'the host id is stable')
  openai.state.expiresIn = 3600
  await provider.generate({ instructions: 'Rules', input: 'Again' })
  assert.equal(openai.state.refreshes, 1)
  assert.match(String(openai.state.responses.at(-1)!.authorization), /Bearer access-\d+/)

  const signedOut = await provider.signOut()
  assert.equal(signedOut.state, 'signed-out')
  assert.ok(openai.state.revoked.length >= 2, 'signing out revokes the renewable session')
  await assert.rejects(provider.generate({ instructions: 'Rules', input: 'After sign-out' }), /Sign in with ChatGPT/)
}))

test('ChatGPT sign-in without plan permission, or into a different account, is not used for requests', async () => withDirectory(async (directory) => {
  const openai = fakeOpenAI()
  const provider = new ChatGPTProvider({ storage: fileProviderStorage(directory, cipher), openBrowser: openai.openBrowser, fetch: openai.fetcher, keys: openai.keys, apiBase: 'https://api.test/v1' })
  openai.state.scope = 'email offline_access openid profile'
  assert.equal((await provider.signIn()).state, 'needs-permission')
  await assert.rejects(provider.generate({ instructions: 'Rules', input: 'Question' }), /plan usage is not enabled/)
  openai.state.scope = 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke'
  assert.equal((await provider.signIn()).state, 'ready')
  assert.equal(openai.state.authorizations.at(-1)!.searchParams.get('prompt'), 'consent', 'declined plan usage is requested again explicitly')
  openai.state.subject = 'someone-else'
  await assert.rejects(provider.signIn(), /different ChatGPT account/)
  assert.equal((await provider.status()).account, 'person@example.com', 'the original account stays active')
}))

test('ID tokens are checked for signature, audience, and nonce', async () => {
  const openai = fakeOpenAI()
  openai.state.nonce = 'n1'
  const token = openai.idToken('client-a')
  assert.equal((await verifyIdToken(token, { clientId: 'client-a', nonce: 'n1' }, openai.keys)).subject, 'user-1')
  await assert.rejects(verifyIdToken(token, { clientId: 'client-b', nonce: 'n1' }, openai.keys), /another client/)
  await assert.rejects(verifyIdToken(token, { clientId: 'client-a', nonce: 'n2' }, openai.keys), /does not match/)
  const [header, body] = token.split('.')
  await assert.rejects(verifyIdToken(`${header}.${body}.${Buffer.from('forged').toString('base64url')}`, { clientId: 'client-a', nonce: 'n1' }, openai.keys), /signature/)
  const pkce = createPkce()
  assert.equal(pkce.challenge, createHash('sha256').update(pkce.verifier).digest('base64url'))
  assert.ok(!authorizeURL({ redirectUri: 'http://127.0.0.1:1455/auth/callback', hostId: 'urn:uuid:x', state: 's', nonce: 'n', challenge: 'c' }).includes('prompt='))
})

test('the registry records which model answered and validates provider settings', async () => withDirectory(async (directory) => {
  const workspace = new Workspace(directory)
  await workspace.initialize()
  const storage = fileProviderStorage(join(directory, 'app'), { available: () => false, encrypt: () => { throw new Error('unused') }, decrypt: () => { throw new Error('unused') } })
  const fake = (id: 'chatgpt' | 'copilot' | 'openai-compatible'): ModelProvider => ({ id, status: async () => ({ state: 'ready' }), listModels: async () => [],
    generate: async (request) => ({ text: `${id}: ${request.input}`, model: `${id}-model` }) })
  const registry = new ProviderRegistry({ chatgpt: fake('chatgpt'), copilot: fake('copilot'), 'openai-compatible': fake('openai-compatible') }, storage)
  const result = await registry.generate('openai-compatible', directory, { instructions: 'Rules', input: 'Private question' }, { operation: 'conversation', refs: ['entity:x'] })
  assert.equal(result.text, 'openai-compatible: Private question')
  const [activity] = (await workspace.snapshot()).providerActivity
  assert.deepEqual({ provider: activity.provider, model: activity.model, status: activity.status }, { provider: 'openai-compatible', model: 'openai-compatible-model', status: 'completed' })
  await assert.rejects(registry.generate('codex' as never, directory, { instructions: '', input: '' }, { operation: 'conversation', refs: [] }), /Unknown AI provider/)
  await assert.rejects(registry.updateSettings({ provider: 'openai-compatible', baseURL: 'ftp://example.com' }), /http/)
  await assert.rejects(registry.updateSettings({ provider: 'chatgpt', baseURL: 'http://127.0.0.1:1/v1' }), /Only the OpenAI-compatible/)
  await registry.updateSettings({ provider: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', model: 'llama3' })
  const moved = await registry.updateSettings({ provider: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' })
  assert.deepEqual(moved['openai-compatible'], { baseURL: 'http://127.0.0.1:1234/v1' }, 'a different server starts without the old model choice')
  await storage.setSecret('openai-compatible', 'session-only')
  assert.equal(await storage.secret('openai-compatible'), 'session-only')
  assert.ok(!(await readFile(join(directory, 'app', 'provider-credentials.json'), 'utf8')).includes('session-only'), 'without system encryption a key is kept only in memory')
  workspace.close()
}))
