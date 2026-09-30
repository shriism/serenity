import type { ModelOption, ProviderId, ProviderStatus } from '../../shared/providers'

/**
 * One inference request. Serenity assembles the complete context itself (workspace records, earlier turns, and the
 * person's message), so a provider sees text in and text out: no tools, files, sessions, or agent state.
 */
export interface InferenceRequest {
  /** Serenity's standing rules for this operation, sent as the provider's system or developer instructions. */
  instructions: string
  /** Everything specific to this request. */
  input: string
  /** A model id from `listModels`; the provider's configured or default model is used when omitted. */
  model?: string
}

export interface InferenceOptions {
  /** Aborting stops the request at the provider and rejects with a cancellation error. */
  signal?: AbortSignal
  /** Receives text as it is generated, for providers that stream. */
  onText?(delta: string): void
}

/** The answer, and the model that produced it when the provider reports one. */
export interface InferenceResult { text: string; model?: string }

export interface SignInOptions {
  signal?: AbortSignal
  /** Adds another account instead of signing back in to the last one. */
  newAccount?: boolean
}

/**
 * The only surface Serenity's conversation, retrieval, citation, proposal, permission, and persistence code uses to
 * reach a model. Implementations own their authentication and transport and nothing else.
 */
export interface ModelProvider {
  readonly id: ProviderId
  /** Checks whether a request could be sent now, without sending workspace content. */
  status(signal?: AbortSignal): Promise<ProviderStatus>
  listModels(signal?: AbortSignal): Promise<ModelOption[]>
  generate(request: InferenceRequest, options?: InferenceOptions): Promise<InferenceResult>
  /** Interactive sign-in, for providers whose service offers one to desktop apps. */
  signIn?(options?: SignInOptions): Promise<ProviderStatus>
  /** Abandons a sign-in that is waiting for the person to finish in the browser. */
  cancelSignIn?(): void
  signOut?(): Promise<ProviderStatus>
  /** Stores a token or API key; an empty value removes it. */
  setCredential?(value: string): Promise<ProviderStatus>
  /** Releases connections or runtimes the provider keeps between requests. */
  dispose?(): Promise<void>
}

export class ProviderError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message) }
}

export const cancelled = (): Error => new Error('AI request cancelled')

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled()
}
