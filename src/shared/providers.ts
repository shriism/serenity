/** The model services Serenity can use. Each one only supplies inference; Serenity owns orchestration and workspace access. */
export const providerIds = ['chatgpt', 'copilot', 'openai-compatible'] as const
export type ProviderId = (typeof providerIds)[number]

export const providerLabels: Record<ProviderId, string> = {
  chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', 'openai-compatible': 'OpenAI-compatible'
}

/** Short names for compact controls. */
export const providerShortLabels: Record<ProviderId, string> = { chatgpt: 'ChatGPT', copilot: 'Copilot', 'openai-compatible': 'Custom' }

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
  'openai-compatible': { baseURL?: string; model?: string }
}

/** Common local and hosted endpoints that speak the OpenAI-compatible API. */
export const compatiblePresets = [
  { id: 'ollama', label: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' },
  { id: 'lm-studio', label: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1' },
  { id: 'vllm', label: 'vLLM', baseURL: 'http://127.0.0.1:8000/v1' },
  { id: 'llama-cpp', label: 'llama.cpp server', baseURL: 'http://127.0.0.1:8080/v1' },
  { id: 'openai', label: 'OpenAI API', baseURL: 'https://api.openai.com/v1' }
] as const

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLoopbackURL(value: string): boolean {
  try { return loopbackHosts.has(new URL(value).hostname) } catch { return false }
}

/** Normalizes a user-entered base URL, refusing anything other than plain http(s) without credentials or a query. */
export function normalizeBaseURL(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a full URL, such as http://127.0.0.1:11434/v1') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The base URL must start with http:// or https://')
  if (url.username || url.password) throw new Error('Put the API key in its own field, not in the URL')
  if (url.search || url.hash) throw new Error('The base URL cannot include a query or fragment')
  return url.href.replace(/\/+$/, '')
}

/** Where ChatGPT account holders review and limit how apps use their plan. */
export const chatGPTUsageURL = 'https://chatgpt.com/settings/usage'
