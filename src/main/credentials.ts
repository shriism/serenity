import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Provider } from '../shared/types'

const credentialPath = (): string => join(app.getPath('userData'), 'provider-credentials.json')

async function stored(): Promise<Partial<Record<Provider, string>>> {
  try { return JSON.parse(await readFile(credentialPath(), 'utf8')) as Partial<Record<Provider, string>> }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
}

export async function credentialStatus(): Promise<Record<Provider, boolean>> {
  const keys = await stored()
  return { copilot: Boolean(keys.copilot), codex: Boolean(keys.codex), claude: Boolean(keys.claude) }
}

export async function saveCredential(provider: Provider, key: string): Promise<void> {
  if (!['copilot', 'codex', 'claude'].includes(provider)) throw new Error('Unknown provider')
  const keys = await stored()
  if (key.trim()) {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend() === 'basic_text') {
      throw new Error('Secure system credential storage is unavailable. Use a provider environment variable instead.')
    }
    keys[provider] = safeStorage.encryptString(key.trim()).toString('base64')
  } else delete keys[provider]
  await mkdir(dirname(credentialPath()), { recursive: true })
  await writeFile(credentialPath(), JSON.stringify(keys), { mode: 0o600 })
}

export async function getCredential(provider: Provider): Promise<string | undefined> {
  const saved = (await stored())[provider]
  return saved ? safeStorage.decryptString(Buffer.from(saved, 'base64')) : undefined
}
