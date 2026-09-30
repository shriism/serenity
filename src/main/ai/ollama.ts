import { defaultOllamaURL, type ModelOption, type ProviderStatus } from '../../shared/providers'
import { cancelled, ProviderError, throwIfCancelled, type InferenceOptions, type InferenceRequest, type InferenceResult, type ModelProvider } from './model-provider'
import { readOllamaStream, requestSignal, responseError } from './streams'
import type { ProviderStorage } from './storage'

const service = 'Ollama'

/**
 * Workspace context for a local model, in characters. A model reads the whole prompt before writing, at roughly
 * 150–250 tokens a second for a 27B model on a laptop, and Serenity's records average about 2.4 characters a token,
 * so this keeps the wait to read a request around half a minute. Longer records arrive as ranked excerpts.
 */
const localContextBudget = 10_000
/** Used when Ollama does not report the context window of a model that is not loaded yet. */
const assumedContextTokens = 4096

/**
 * Models running in Ollama, on this computer or another machine the person chooses, through Ollama's own API:
 * `/api/tags` for installed models and streamed `/api/chat` for answers. Nothing leaves the chosen machine.
 */
export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama' as const
  private readonly fetch: typeof fetch

  private readonly capabilities = new Map<string, Promise<string[]>>()

  constructor(private readonly storage: ProviderStorage, fetcher?: typeof fetch) { this.fetch = fetcher ?? fetch }

  /** What a model supports, such as `thinking`; asked once per model and address. */
  private modelCapabilities(baseURL: string, model: string): Promise<string[]> {
    const key = `${baseURL} ${model}`
    let known = this.capabilities.get(key)
    if (!known) {
      known = this.fetch(`${baseURL}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) })
        .then(async (response) => response.ok ? ((await response.json()) as { capabilities?: unknown }).capabilities : [])
        .then((value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
      known.catch(() => this.capabilities.delete(key))
      this.capabilities.set(key, known)
    }
    return known.catch(() => [])
  }

  /** A smaller context than hosted models get, and never more than the loaded model's context window can hold. */
  async contextBudget(signal?: AbortSignal): Promise<number> {
    const endpoint = await this.endpoint()
    let contextTokens = assumedContextTokens
    try {
      const response = await this.fetch(`${endpoint.baseURL}/api/ps`, { signal })
      const loaded = response.ok ? ((await response.json()) as { models?: { name?: unknown; model?: unknown; context_length?: unknown }[] }).models ?? [] : []
      const model = endpoint.model ?? loaded[0]?.model
      const running = loaded.find((item) => item.model === model || item.name === model)
      if (typeof running?.context_length === 'number') contextTokens = running.context_length
    } catch { /* Keep the conservative assumption. */ }
    // Half the window is left for Serenity's instructions, the conversation, and the answer.
    return Math.min(localContextBudget, Math.floor(contextTokens * 2.4 * 0.5))
  }

  private async endpoint(): Promise<{ baseURL: string; model?: string }> {
    const settings = (await this.storage.settings()).ollama
    return { baseURL: settings.baseURL ?? defaultOllamaURL, ...(settings.model ? { model: settings.model } : {}) }
  }

  async status(signal?: AbortSignal): Promise<ProviderStatus> {
    const { baseURL } = await this.endpoint()
    const account = new URL(baseURL).host
    try {
      const models = await this.listModels(signal, 5000)
      if (!models.length) return { state: 'not-configured', account, credential: 'none', detail: 'Ollama is running but has no models yet. Download one with “ollama pull”, then check again.' }
      return { state: 'ready', account, credential: 'none' }
    } catch (error) {
      return { state: 'unavailable', account, credential: 'none', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async listModels(signal?: AbortSignal, timeout = 15_000): Promise<ModelOption[]> {
    const { baseURL } = await this.endpoint()
    const limit = requestSignal(signal, timeout)
    try {
      const response = await this.fetch(`${baseURL}/api/tags`, { headers: { Accept: 'application/json' }, signal: limit.signal })
      if (!response.ok) throw await responseError(response, service)
      const body = await response.json() as { models?: { name?: unknown; model?: unknown; details?: { parameter_size?: unknown } }[] }
      return (body.models ?? []).flatMap((item) => {
        const id = typeof item.model === 'string' ? item.model : typeof item.name === 'string' ? item.name : undefined
        const size = typeof item.details?.parameter_size === 'string' ? ` · ${item.details.parameter_size}` : ''
        return id ? [{ id, label: `${id}${size}` }] : []
      })
    } catch (error) {
      if (signal?.aborted) throw cancelled()
      if (error instanceof ProviderError) throw error
      throw new ProviderError(`Ollama isn’t running at ${new URL(baseURL).host}. Start Ollama, then check again.`, 'unreachable')
    } finally { limit.done() }
  }

  async generate(request: InferenceRequest, options: InferenceOptions = {}): Promise<InferenceResult> {
    throwIfCancelled(options.signal)
    const endpoint = await this.endpoint()
    const model = request.model ?? endpoint.model ?? (await this.listModels(options.signal))[0]?.id
    if (!model) throw new ProviderError('Ollama has no models yet. Download one with “ollama pull”.', 'no_model')
    // Serenity supplies the records an answer needs, so a reasoning pass mostly adds minutes of hidden output.
    const think = (await this.modelCapabilities(endpoint.baseURL, model)).includes('thinking') ? { think: false } : {}
    // Loading a large model into memory can take minutes on the first request.
    const limit = requestSignal(options.signal, 10 * 60_000)
    let response: Response
    try {
      response = await this.fetch(`${endpoint.baseURL}/api/chat`, {
        method: 'POST', signal: limit.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true, ...think, messages: [{ role: 'system', content: request.instructions }, { role: 'user', content: request.input }] })
      })
    } catch {
      limit.done()
      if (options.signal?.aborted) throw cancelled()
      throw new ProviderError(`Ollama isn’t running at ${new URL(endpoint.baseURL).host}. Start Ollama and try again.`, 'unreachable')
    }
    try {
      if (!response.ok) throw await responseError(response, service)
      if (!response.body) throw new ProviderError(`${service} returned an empty response.`)
      const result = await readOllamaStream(response.body, { ...options, signal: limit.signal }, service)
      return { text: result.text, model: result.model ?? model }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled()
      if (limit.timedOut()) throw new ProviderError(`${service} took too long to respond.`, 'timeout')
      if (error instanceof ProviderError) throw error
      // The server accepted the request and then went away, as when Ollama restarts or runs out of memory.
      throw new ProviderError('Ollama stopped before finishing the answer. It may have restarted; try again.', 'interrupted')
    } finally { limit.done() }
  }
}
