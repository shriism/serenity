import type { Provider, ProviderConnectionStatus } from '../shared/types'
import { getCredential } from './credentials'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { trackProviderCall, type ActivityRequest } from './provider-activity'

const codexTargets: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl', 'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc', 'win32-x64': 'x86_64-pc-windows-msvc'
}

function codexRuntime(): { binary: string; vendor: string } | null {
  const platform = `${process.platform}-${process.arch}`
  const triple = codexTargets[platform]
  if (!triple) return null
  const modules = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules') : join(app.getAppPath(), 'node_modules')
  const vendor = join(modules, `@openai/codex-${platform}`, 'vendor', triple)
  return { binary: join(vendor, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'), vendor }
}

function codexEnvironment(vendor: string): Record<string, string> {
  const pathKey = Object.keys(process.env).find((name) => name.toLowerCase() === 'path') ?? 'PATH'
  const extraPaths = [join(vendor, 'codex-path'), join(vendor, 'path')].filter(existsSync)
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  env[pathKey] = [...extraPaths, env[pathKey]].filter(Boolean).join(delimiter)
  return env
}

/** Checks the authentication that a provider request would use, without sending workspace content. */
export async function checkProviderStatus(provider: Provider, workspace: string): Promise<ProviderConnectionStatus> {
  if (await getCredential(provider)) return { state: 'key-saved' }
  if (provider === 'codex') {
    const runtime = codexRuntime()
    if (!runtime || !existsSync(runtime.binary)) return { state: 'unavailable' }
    return new Promise((resolve) => execFile(runtime.binary, ['login', 'status'],
      { env: codexEnvironment(runtime.vendor), timeout: 8000, windowsHide: true }, (error) => {
        if (!error) resolve({ state: 'signed-in' })
        else resolve({ state: (error as { code?: number | string }).code === 1 ? 'signed-out' : 'unavailable' })
      }))
  }
  if (provider === 'copilot') {
    try {
      const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk')
      const platform = `${process.platform}-${process.arch}`
      const runtime = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', `@github/copilot-sdk-${platform}`,
        'prebuilds', platform, process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime')
      const client = new CopilotClient({ mode: 'empty', baseDirectory: join(homedir(), '.copilot'), workingDirectory: workspace,
        ...(app.isPackaged ? { connection: RuntimeConnection.forStdio({ path: runtime }) } : {}) })
      await client.start()
      try {
        const result = await client.getAuthStatus()
        return result.isAuthenticated ? { state: 'signed-in', ...(result.login ? { account: result.login } : {}) } : { state: 'signed-out' }
      } finally { await client.stop() }
    } catch { return { state: 'unavailable' } }
  }
  return { state: 'unavailable' }
}

export async function checkProviders(workspace: string): Promise<Record<Provider, ProviderConnectionStatus>> {
  const [copilot, codex] = await Promise.all([checkProviderStatus('copilot', workspace), checkProviderStatus('codex', workspace)])
  return { copilot, codex }
}

export async function askProvider(provider: Provider, workspace: string, prompt: string,
  activity: ActivityRequest = { operation: 'conversation', refs: [] }, signal?: AbortSignal): Promise<string> {
  return trackProviderCall(workspace, provider, prompt, activity, () => runProvider(provider, workspace, prompt, signal))
}

async function runProvider(provider: Provider, workspace: string, prompt: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('AI request cancelled')
  if (provider === 'copilot') {
    const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk')
    const token = await getCredential('copilot')
    const platform = `${process.platform}-${process.arch}`
    const runtime = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', `@github/copilot-sdk-${platform}`,
      'prebuilds', platform, process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime')
    const client = new CopilotClient({ mode: 'empty', baseDirectory: join(homedir(), '.copilot'), workingDirectory: workspace,
      ...(app.isPackaged ? { connection: RuntimeConnection.forStdio({ path: runtime }) } : {}),
      ...(token ? { gitHubToken: token } : {}) })
    await client.start()
    try {
      const session = await client.createSession({
        workingDirectory: workspace,
        availableTools: [],
        onPermissionRequest: () => ({ kind: 'reject', feedback: 'Serenity handles knowledge changes through reviewed proposals.' })
      })
      const abort = (): void => { void session.abort().catch(() => undefined) }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        if (signal?.aborted) throw new Error('AI request cancelled')
        const answer = await session.sendAndWait({ prompt }, 120000)
        if (signal?.aborted) throw new Error('AI request cancelled')
        if (!answer?.data.content) throw new Error('Copilot returned no answer.')
        return answer.data.content
      } finally { signal?.removeEventListener('abort', abort); await session.disconnect() }
    } finally { await client.stop() }
  }

  if (provider === 'codex') {
    const { Codex } = await import('@openai/codex-sdk')
    const key = await getCredential('codex')
    const platform = `${process.platform}-${process.arch}`
    const runtime = codexRuntime()
    if (app.isPackaged && (!runtime || !existsSync(runtime.binary))) throw new Error(`Bundled Codex runtime is missing for ${platform}`)
    const codex = new Codex({ ...(key ? { apiKey: key } : {}), ...(app.isPackaged && runtime ? { codexPathOverride: runtime.binary, env: codexEnvironment(runtime.vendor) } : {}) })
    const thread = codex.startThread({
      workingDirectory: workspace,
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false
    })
    const turn = await thread.run(prompt, { signal })
    if (signal?.aborted) throw new Error('AI request cancelled')
    if (!turn.finalResponse) throw new Error('Codex returned no answer.')
    return turn.finalResponse
  }

  throw new Error('Unknown AI provider')
}
