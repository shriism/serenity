/** The model services Serenity can use. Each one only supplies inference; Serenity owns orchestration and workspace access. */
export const providerIds = ['chatgpt', 'copilot', 'ollama'] as const
export type ProviderId = (typeof providerIds)[number]

export const providerLabels: Record<ProviderId, string> = {
  chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', ollama: 'Ollama'
}

/** Short names for compact controls. */
export const providerShortLabels: Record<ProviderId, string> = { chatgpt: 'ChatGPT', copilot: 'Copilot', ollama: 'Ollama' }

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (providerIds as readonly string[]).includes(value)
}

/** How a recorded provider is named to people; older records may name providers that are no longer offered. */
export function providerName(recorded: string | undefined): string {
  if (!recorded) return 'AI'
  if (isProviderId(recorded)) return providerLabels[recorded]
  if (recorded === 'codex') return 'Codex'
  return `${recorded.charAt(0).toUpperCase()}${recorded.slice(1)}`
}

export interface ProviderStatus {
  /** `ready` means a request can be sent; every other state explains what is missing. */
  state: 'ready' | 'signed-out' | 'not-configured' | 'needs-permission' | 'unavailable'
  /** The signed-in account or endpoint, when known. */
  account?: string
  /** Where the credential comes from, so settings can offer the right control to change it. */
  credential?: 'sign-in' | 'token' | 'api-key' | 'none'
  detail?: string
  /** Set on the sign-in that first lets Serenity use this person's ChatGPT plan, so it can say so once. */
  firstPlanUse?: boolean
}

export interface ModelOption { id: string; label: string }

export interface ProviderSettings {
  chatgpt: { model?: string }
  copilot: { model?: string }
  ollama: { baseURL?: string; model?: string }
}

/** Where Ollama listens unless it has been configured otherwise. */
export const defaultOllamaURL = 'http://127.0.0.1:11434'

/** Normalizes a user-entered base URL, refusing anything other than plain http(s) without credentials or a query. */
export function normalizeBaseURL(value: string): string {
  if (!value.trim()) throw new Error('Enter the address Ollama is listening on, such as http://127.0.0.1:11434')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a full URL, such as http://127.0.0.1:11434') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The base URL must start with http:// or https://')
  if (url.username || url.password) throw new Error('The address cannot include a user name or password')
  if (url.search || url.hash) throw new Error('The base URL cannot include a query or fragment')
  // Ollama's own API sits at the root; addresses copied from OpenAI-style setups end in /v1 or /api.
  return url.href.replace(/\/+$/, '').replace(/\/(v1|api)$/, '')
}

/** Where ChatGPT account holders review and limit how apps use their plan. */
export const chatGPTUsageURL = 'https://chatgpt.com/settings/usage'
