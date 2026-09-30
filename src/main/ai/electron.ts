import { app, safeStorage, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ChatGPTProvider } from './chatgpt'
import { CopilotProvider } from './copilot'
import { OllamaProvider } from './ollama'
import { ProviderRegistry } from './registry'
import { fileProviderStorage, type SecretCipher } from './storage'

/** OS-backed encryption; Linux's plain-text fallback is treated as unavailable so secrets stay in memory instead. */
const cipher: SecretCipher = {
  available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' ||
    (typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() !== 'basic_text')),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function copilotRuntime(): string | undefined {
  if (!app.isPackaged) return undefined
  const platform = `${process.platform}-${process.arch}`
  return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', `@github/copilot-sdk-${platform}`,
    'prebuilds', platform, process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime')
}

export function createProviderRegistry(): ProviderRegistry {
  const directory = app.getPath('userData')
  const storage = fileProviderStorage(directory, cipher)
  const isolated = join(directory, 'model-runtime')
  mkdirSync(isolated, { recursive: true })
  return new ProviderRegistry({
    chatgpt: new ChatGPTProvider({ storage, openBrowser: (url) => shell.openExternal(url) }),
    copilot: new CopilotProvider({ storage, runtimePath: copilotRuntime(), workingDirectory: isolated }),
    ollama: new OllamaProvider(storage)
  }, storage)
}
