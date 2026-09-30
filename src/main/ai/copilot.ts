import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CopilotClient } from '@github/copilot-sdk'
import type { ModelOption, ProviderStatus } from '../../shared/providers'
import { cancelled, ProviderError, throwIfCancelled, type InferenceOptions, type InferenceRequest, type InferenceResult, type ModelProvider } from './model-provider'
import type { ProviderStorage } from './storage'

const secretName = 'copilot'

export interface CopilotDependencies {
  storage: ProviderStorage
  /** The bundled Copilot runtime in a packaged app; development uses the SDK's own resolution. */
  runtimePath?: string
  /** An empty app-owned folder. The runtime never sees a workspace path, so it cannot read or edit workspace files. */
  workingDirectory: string
}

/**
 * GitHub Copilot through the user's own Copilot subscription. GitHub offers subscription-backed model access to other
 * apps only through the Copilot SDK, so the SDK is used here and nowhere else, with every agent capability turned off:
 * no tools, shell, file access, MCP servers, skills, sub-agents, custom instructions, memory, or retained sessions.
 * Authentication is the person's existing GitHub sign-in for Copilot, or a GitHub token they provide.
 */
export class CopilotProvider implements ModelProvider {
  readonly id = 'copilot' as const
  private client: Promise<CopilotClient> | null = null

  constructor(private readonly deps: CopilotDependencies) {}

  private start(): Promise<CopilotClient> {
    this.client ??= (async () => {
      const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk')
      const token = await this.deps.storage.secret(secretName)
      const client = new CopilotClient({
        mode: 'empty', baseDirectory: join(homedir(), '.copilot'), workingDirectory: this.deps.workingDirectory,
        ...(this.deps.runtimePath ? { connection: RuntimeConnection.forStdio({ path: this.deps.runtimePath }) } : {}),
        ...(token ? { gitHubToken: token, useLoggedInUser: false } : {})
      })
      await client.start()
      return client
    })()
    const pending = this.client
    pending.catch(() => { if (this.client === pending) this.client = null })
    return pending
  }

  async dispose(): Promise<void> {
    const pending = this.client
    this.client = null
    if (pending) await pending.then((client) => client.stop(), () => undefined)
  }

  async status(): Promise<ProviderStatus> {
    const hasToken = Boolean(await this.deps.storage.secret(secretName))
    const credential = hasToken ? 'token' as const : 'sign-in' as const
    try {
      const result = await (await this.start()).getAuthStatus()
      if (!result.isAuthenticated) {
        // A sign-in made later with GitHub's tools is picked up by the next check's fresh runtime.
        await this.dispose()
        return { state: 'signed-out', credential: hasToken ? 'token' : 'none', ...(hasToken ? { detail: 'GitHub did not accept the saved token.' } : {}) }
      }
      return { state: 'ready', credential, ...(result.login ? { account: result.login } : {}) }
    } catch (error) {
      return { state: 'unavailable', credential, detail: `The Copilot runtime could not start: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  async setCredential(value: string): Promise<ProviderStatus> {
    await this.deps.storage.setSecret(secretName, value.trim() || undefined)
    await this.dispose()
    return this.status()
  }

  async listModels(): Promise<ModelOption[]> {
    const models = await (await this.start()).listModels()
    return models.filter((model) => model.policy?.state !== 'disabled').map((model) => ({ id: model.id, label: model.name || model.id }))
  }

  async generate(request: InferenceRequest, options: InferenceOptions = {}): Promise<InferenceResult> {
    throwIfCancelled(options.signal)
    const client = await this.start()
    const model = request.model ?? (await this.deps.storage.settings()).copilot.model
    const session = await client.createSession({
      clientName: 'Serenity',
      ...(model ? { model } : {}),
      workingDirectory: this.deps.workingDirectory,
      streaming: true,
      systemMessage: { mode: 'replace', content: request.instructions },
      availableTools: [],
      mcpServers: {},
      customAgents: [],
      skipCustomInstructions: true,
      enableConfigDiscovery: false,
      infiniteSessions: { enabled: false },
      memory: { enabled: false },
      onPermissionRequest: () => ({ kind: 'reject', feedback: 'Serenity does not allow tools. Answer with text only.' })
    })
    let text = ''
    const stopListening = session.on((event) => {
      if (event.type === 'assistant.message_delta' && !event.data.parentToolCallId) { text += event.data.deltaContent; options.onText?.(event.data.deltaContent) }
    })
    const abort = (): void => { void session.abort().catch(() => undefined) }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      const answer = await session.sendAndWait({ prompt: request.input }, 5 * 60_000)
      throwIfCancelled(options.signal)
      const content = answer?.data.content ?? text
      if (!content) throw new ProviderError('Copilot returned no answer.', 'empty')
      return { text: content, ...(model ? { model } : {}) }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled()
      throw error
    } finally {
      options.signal?.removeEventListener('abort', abort)
      stopListening()
      await session.disconnect().catch(() => undefined)
      // Serenity keeps its own conversation records; the runtime should not keep a second copy of workspace content.
      await client.deleteSession(session.sessionId).catch(() => undefined)
    }
  }
}
