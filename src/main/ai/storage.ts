import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { normalizeBaseURL, type ProviderSettings } from '../../shared/providers'

/** Encryption supplied by the operating system; unavailable encryption keeps secrets in memory for this session only. */
export interface SecretCipher {
  available(): boolean
  encrypt(value: string): string
  decrypt(value: string): string
}

/**
 * Provider credentials and settings, kept with the app rather than in any workspace. Secrets are encrypted when the
 * system offers encryption; settings and non-secret sign-in state are plain JSON.
 */
export interface ProviderStorage {
  secret(name: string): Promise<string | undefined>
  setSecret(name: string, value: string | undefined): Promise<void>
  /** Whether saved secrets outlive this session. */
  persistent(): boolean
  settings(): Promise<ProviderSettings>
  updateSettings(change: (settings: ProviderSettings) => void): Promise<ProviderSettings>
  state<T>(name: string): Promise<T | undefined>
  setState(name: string, value: unknown): Promise<void>
}

type SettingsFile = { settings?: Partial<ProviderSettings>; state?: Record<string, unknown> }

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error }
}

async function writeJSON(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); await rename(temp, path) }
  catch (error) { await unlink(temp).catch(() => undefined); throw error }
}

function cleanSettings(raw: Partial<ProviderSettings> | undefined): ProviderSettings {
  const model = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined
  const compatible = raw?.['openai-compatible']
  let baseURL: string | undefined
  try { baseURL = typeof compatible?.baseURL === 'string' && compatible.baseURL ? normalizeBaseURL(compatible.baseURL) : undefined } catch { baseURL = undefined }
  const chatgptModel = model(raw?.chatgpt?.model)
  const copilotModel = model(raw?.copilot?.model)
  const compatibleModel = model(compatible?.model)
  return {
    chatgpt: chatgptModel ? { model: chatgptModel } : {},
    copilot: copilotModel ? { model: copilotModel } : {},
    'openai-compatible': { ...(baseURL ? { baseURL } : {}), ...(compatibleModel ? { model: compatibleModel } : {}) }
  }
}

export function fileProviderStorage(directory: string, cipher: SecretCipher): ProviderStorage {
  const secretsPath = join(directory, 'provider-credentials.json')
  const settingsPath = join(directory, 'ai-providers.json')
  const session = new Map<string, string>()
  // Writes are serialized so concurrent token refreshes and settings changes cannot overwrite one another.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }
  const ready = mkdir(directory, { recursive: true })

  return {
    persistent: () => cipher.available(),
    async secret(name) {
      if (session.has(name)) return session.get(name)
      const saved = (await readJSON<Record<string, string>>(secretsPath, {}))[name]
      return saved && cipher.available() ? cipher.decrypt(saved) : undefined
    },
    setSecret: (name, value) => serialized(async () => {
      await ready
      const secrets = await readJSON<Record<string, string>>(secretsPath, {})
      // Credentials for providers Serenity no longer offers are dropped rather than left on disk.
      delete secrets.codex
      if (value && cipher.available()) { secrets[name] = cipher.encrypt(value); session.delete(name) }
      else if (value) { session.set(name, value); delete secrets[name] }
      else { delete secrets[name]; session.delete(name) }
      await writeJSON(secretsPath, secrets)
    }),
    async settings() { return cleanSettings((await readJSON<SettingsFile>(settingsPath, {})).settings) },
    updateSettings: (change) => serialized(async () => {
      await ready
      const file = await readJSON<SettingsFile>(settingsPath, {})
      const settings = cleanSettings(file.settings)
      change(settings)
      const next = cleanSettings(settings)
      await writeJSON(settingsPath, { ...file, settings: next })
      return next
    }),
    async state<T>(name: string) { return (await readJSON<SettingsFile>(settingsPath, {})).state?.[name] as T | undefined },
    setState: (name, value) => serialized(async () => {
      await ready
      const file = await readJSON<SettingsFile>(settingsPath, {})
      await writeJSON(settingsPath, { ...file, state: { ...file.state, [name]: value } })
    })
  }
}
