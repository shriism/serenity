import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import type { Provider } from '../shared/types'

const credentialPath = (): string => join(app.getPath('userData'), 'provider-credentials.json')
const sessionKeys = new Map<Provider, string>()

function canStorePersistently(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform !== 'linux') return true
  return typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

async function stored(): Promise<Partial<Record<Provider, string>>> {
  try { return JSON.parse(await readFile(credentialPath(), 'utf8')) as Partial<Record<Provider, string>> }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
}

export async function credentialStatus(): Promise<Record<Provider, boolean>> {
  const keys = await stored()
  const status = (provider: Provider): boolean => sessionKeys.has(provider) || Boolean(canStorePersistently() && keys[provider])
  return { copilot: status('copilot'), codex: status('codex') }
}

export async function saveCredential(provider: Provider, key: string): Promise<void> {
  if (!['copilot', 'codex'].includes(provider)) throw new Error('Unknown provider')
  const keys = await stored()
  if (key.trim()) {
    if (canStorePersistently()) {
      keys[provider] = safeStorage.encryptString(key.trim()).toString('base64')
      sessionKeys.delete(provider)
    } else {
      sessionKeys.set(provider, key.trim())
      delete keys[provider]
    }
  } else { delete keys[provider]; sessionKeys.delete(provider) }
  await mkdir(dirname(credentialPath()), { recursive: true })
  const temp = `${credentialPath()}.${randomUUID()}.tmp`
  try { await writeFile(temp, JSON.stringify(keys), { mode: 0o600, flag: 'wx' }); await rename(temp, credentialPath()) }
  catch (error) { await unlink(temp).catch(() => undefined); throw error }
}

export async function getCredential(provider: Provider): Promise<string | undefined> {
  if (sessionKeys.has(provider)) return sessionKeys.get(provider)
  const saved = (await stored())[provider]
  return saved && canStorePersistently() ? safeStorage.decryptString(Buffer.from(saved, 'base64')) : undefined
}
