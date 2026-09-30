import { defaultOllamaURL, type ModelOption, type ProviderStatus } from '../../shared/providers'
import { cancelled, ProviderError, throwIfCancelled, type InferenceOptions, type InferenceRequest, type InferenceResult, type ModelProvider } from './model-provider'
import { readOllamaStream, requestSignal, responseError } from './streams'
import type { ProviderStorage } from './storage'

const service = 'Ollama'

/**
 * Models running in Ollama, on this computer or another machine the person chooses, through Ollama's own API:
 * `/api/tags` for installed models and streamed `/api/chat` for answers. Nothing leaves the chosen machine.
 */
export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama' as const
  private readonly fetch: typeof fetch

  constructor(private readonly storage: ProviderStorage, fetcher?: typeof fetch) { this.fetch = fetcher ?? fetch }

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
    // Loading a large model into memory can take minutes on the first request.
    const limit = requestSignal(options.signal, 10 * 60_000)
    try {
      const response = await this.fetch(`${endpoint.baseURL}/api/chat`, {
        method: 'POST', signal: limit.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: request.instructions }, { role: 'user', content: request.input }] })
      })
      if (!response.ok) throw await responseError(response, service)
      if (!response.body) throw new ProviderError(`${service} returned an empty response.`)
      const result = await readOllamaStream(response.body, { ...options, signal: limit.signal }, service)
      return { text: result.text, model: result.model ?? model }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled()
      if (limit.timedOut()) throw new ProviderError(`${service} took too long to respond.`, 'timeout')
      if (error instanceof ProviderError) throw error
      throw new ProviderError(`Ollama isn’t running at ${new URL(endpoint.baseURL).host}. Start Ollama and try again.`, 'unreachable')
    } finally { limit.done() }
  }
}
