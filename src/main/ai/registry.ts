import { isProviderId, normalizeBaseURL, providerIds, providerLabels, type ProviderId, type ProviderSettings, type ProviderStatus } from '../../shared/providers'
import { trackProviderCall, type ActivityRequest } from '../provider-activity'
import type { InferenceOptions, InferenceRequest, InferenceResult, ModelProvider } from './model-provider'
import type { ProviderStorage } from './storage'
import { defaultContextBudget } from '../context'

/** How Serenity's own features reach a model: one call, recorded in the workspace's provider activity. */
export type Generate = (provider: ProviderId, workspacePath: string, request: InferenceRequest, activity: ActivityRequest,
  options?: InferenceOptions) => Promise<InferenceResult>

export interface ProviderSettingsChange { provider: ProviderId; model?: string | null; baseURL?: string }

export class ProviderRegistry {
  constructor(private readonly providers: Record<ProviderId, ModelProvider>, readonly storage: ProviderStorage) {}

  get(id: unknown): ModelProvider {
    if (!isProviderId(id)) throw new Error('Unknown AI provider')
    return this.providers[id]
  }

  /** Every provider's status; a provider that cannot answer promptly is reported as unavailable rather than blocking the rest. */
  async statuses(): Promise<Record<ProviderId, ProviderStatus>> {
    const entries = await Promise.all(providerIds.map(async (id): Promise<[ProviderId, ProviderStatus]> => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<ProviderStatus>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve({ state: 'unavailable', detail: `${providerLabels[id]} did not respond in time.` }) }, 20_000)
      })
      try {
        return [id, await Promise.race([this.providers[id].status(controller.signal).catch((error: unknown): ProviderStatus =>
          ({ state: 'unavailable', detail: error instanceof Error ? error.message : String(error) })), timeout])]
      } finally { clearTimeout(timer) }
    }))
    return Object.fromEntries(entries) as Record<ProviderId, ProviderStatus>
  }

  readonly generate: Generate = async (provider, workspacePath, request, activity, options) => {
    const selected = this.get(provider)
    return trackProviderCall(workspacePath, provider, `${request.instructions}\n\n${request.input}`, activity,
      () => selected.generate(request, options), (result) => result.model ? { model: result.model } : {})
  }

  /** How much workspace context to assemble for a provider's requests. */
  async contextBudget(provider: ProviderId, signal?: AbortSignal): Promise<number> {
    const selected = this.get(provider)
    return selected.contextBudget ? selected.contextBudget(signal).catch(() => defaultContextBudget) : defaultContextBudget
  }

  settings(): Promise<ProviderSettings> { return this.storage.settings() }

  async updateSettings(change: ProviderSettingsChange): Promise<ProviderSettings> {
    if (!isProviderId(change.provider)) throw new Error('Unknown AI provider')
    const baseURL = change.baseURL === undefined ? undefined : change.baseURL.trim() ? normalizeBaseURL(change.baseURL) : ''
    if (baseURL !== undefined && change.provider !== 'ollama') throw new Error('Only Ollama has a server address')
    if (change.model !== undefined && change.model !== null && (typeof change.model !== 'string' || change.model.length > 200)) throw new Error('Invalid model')
    return this.storage.updateSettings((settings) => {
      const target = settings[change.provider] as { model?: string; baseURL?: string }
      if (change.model !== undefined) {
        if (change.model?.trim()) target.model = change.model.trim()
        else delete target.model
      }
      if (baseURL !== undefined) {
        // A different server has different models, so its model choice starts over.
        if (baseURL !== target.baseURL && change.model === undefined) delete target.model
        if (baseURL) target.baseURL = baseURL
        else delete target.baseURL
      }
    })
  }

  async dispose(): Promise<void> {
    await Promise.all(providerIds.map((id) => this.providers[id].dispose?.().catch(() => undefined)))
  }
}

let current: ProviderRegistry | null = null

/** Installed once by the main process when the app starts. */
export function setProviderRegistry(registry: ProviderRegistry | null): void { current = registry }

export function currentProviderRegistry(): ProviderRegistry | null { return current }

export function providerRegistry(): ProviderRegistry {
  if (!current) throw new Error('AI providers are not ready yet')
  return current
}
