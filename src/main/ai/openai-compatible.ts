import { isLoopbackURL, type ModelOption, type ProviderStatus } from '../../shared/providers'
import { cancelled, ProviderError, throwIfCancelled, type InferenceOptions, type InferenceRequest, type InferenceResult, type ModelProvider } from './model-provider'
import { readChatCompletionsStream, requestSignal, responseError } from './streams'
import type { ProviderStorage } from './storage'

const secretName = 'openai-compatible'
const service = 'The model server'

/**
 * Any endpoint that serves the OpenAI-compatible `/models` and `/chat/completions` routes: Ollama, LM Studio, vLLM,
 * the llama.cpp server, hosted gateways, or OpenAI itself with an API key.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = 'openai-compatible' as const
  private readonly fetch: typeof fetch

  constructor(private readonly storage: ProviderStorage, fetcher?: typeof fetch) { this.fetch = fetcher ?? fetch }

  private async endpoint(): Promise<{ baseURL: string; model?: string; key?: string }> {
    const settings = (await this.storage.settings())['openai-compatible']
    if (!settings.baseURL) throw new ProviderError('Set a base URL for the OpenAI-compatible provider in Settings.', 'not_configured')
    const key = await this.storage.secret(secretName)
    // A key sent over plain HTTP to another machine could be read in transit.
    if (key && !settings.baseURL.startsWith('https:') && !isLoopbackURL(settings.baseURL)) {
      throw new ProviderError('Use an https:// base URL to send an API key to a server on another machine.', 'insecure_key')
    }
    return { baseURL: settings.baseURL, ...(settings.model ? { model: settings.model } : {}), ...(key ? { key } : {}) }
  }

  private headers(key: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
    return { ...extra, ...(key ? { Authorization: `Bearer ${key}` } : {}) }
  }

  async status(signal?: AbortSignal): Promise<ProviderStatus> {
    const settings = (await this.storage.settings())['openai-compatible']
    if (!settings.baseURL) return { state: 'not-configured', credential: 'none' }
    const hasKey = Boolean(await this.storage.secret(secretName))
    const account = new URL(settings.baseURL).host
    const credential = hasKey ? 'api-key' as const : 'none' as const
    try {
      await this.listModels(signal, 5000)
      return { state: 'ready', account, credential }
    } catch (error) {
      const status = error instanceof ProviderError ? error.status : undefined
      if (status === 401 || status === 403) return { state: 'signed-out', account, credential, detail: hasKey ? 'The server rejected the API key.' : 'The server needs an API key.' }
      return { state: 'unavailable', account, credential, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async setCredential(value: string): Promise<ProviderStatus> {
    await this.storage.setSecret(secretName, value.trim() || undefined)
    return this.status()
  }

  async listModels(signal?: AbortSignal, timeout = 15_000): Promise<ModelOption[]> {
    const { baseURL, key } = await this.endpoint()
    const limit = requestSignal(signal, timeout)
    try {
      const response = await this.fetch(`${baseURL}/models`, { headers: this.headers(key, { Accept: 'application/json' }), signal: limit.signal })
      if (!response.ok) throw await responseError(response, service)
      const body = await response.json() as { data?: { id?: unknown; name?: unknown }[]; models?: { id?: unknown; name?: unknown }[] }
      const items = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
      return items.flatMap((item) => {
        const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : undefined
        return id ? [{ id, label: id }] : []
      })
    } catch (error) {
      if (signal?.aborted) throw cancelled()
      if (limit.timedOut()) throw new ProviderError(`${service} at ${new URL(baseURL).host} did not respond.`, 'timeout')
      if (error instanceof ProviderError) throw error
      throw new ProviderError(`Could not reach ${new URL(baseURL).host}. Check that the server is running.`, 'unreachable')
    } finally { limit.done() }
  }

  async generate(request: InferenceRequest, options: InferenceOptions = {}): Promise<InferenceResult> {
    throwIfCancelled(options.signal)
    const endpoint = await this.endpoint()
    const model = request.model ?? endpoint.model ?? (await this.listModels(options.signal))[0]?.id
    if (!model) throw new ProviderError('Choose a model for the OpenAI-compatible provider in Settings.', 'no_model')
    // Local models can take minutes to load and answer on modest hardware.
    const limit = requestSignal(options.signal, 10 * 60_000)
    try {
      const response = await this.fetch(`${endpoint.baseURL}/chat/completions`, {
        method: 'POST', signal: limit.signal,
        headers: this.headers(endpoint.key, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: request.instructions }, { role: 'user', content: request.input }] })
      })
      if (!response.ok) throw await responseError(response, service)
      if (!response.body) throw new ProviderError(`${service} returned an empty response.`)
      const result = await readChatCompletionsStream(response.body, { ...options, signal: limit.signal }, service)
      return { text: result.text, model: result.model ?? model }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled()
      if (limit.timedOut()) throw new ProviderError(`${service} took too long to respond.`, 'timeout')
      if (error instanceof ProviderError) throw error
      throw new ProviderError(`Could not reach ${new URL(endpoint.baseURL).host}: ${error instanceof Error ? error.message : String(error)}`, 'unreachable')
    } finally { limit.done() }
  }
}
