import { useSyncExternalStore } from 'react'
import { isProviderId, type ProviderId } from '../../shared/providers'

/**
 * Preferences for how this device's window behaves, kept with the app rather than in any workspace (like the theme).
 * Each can be switched in Settings; the defaults are what most people expect.
 */
export interface Preferences {
  /** Escape leaves the editor, hiding Markdown syntax as when reading. */
  escapeLeavesEditing: boolean
  /** Scrollbars appear only while scrolling or pointing at a scrollable area. */
  autoHideScrollbars: boolean
  /** ⌘/Ctrl-1…9 switch tabs. */
  numberedTabShortcuts: boolean
  /** The provider new assistant requests use until another is chosen. */
  assistantProvider: ProviderId
}

const defaults: Preferences = { escapeLeavesEditing: true, autoHideScrollbars: true, numberedTabShortcuts: true, assistantProvider: 'copilot' }
const key = 'serenity.preferences'
const listeners = new Set<() => void>()

function read(): Preferences {
  try {
    const saved = { ...defaults, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Preferences>) }
    // A provider saved by an earlier release may no longer be offered.
    return isProviderId(saved.assistantProvider) ? saved : { ...saved, assistantProvider: defaults.assistantProvider }
  } catch { return { ...defaults } }
}

let current = read()

export const preferences = {
  get: (): Preferences => current,
  set(change: Partial<Preferences>): void {
    current = { ...current, ...change }
    try { localStorage.setItem(key, JSON.stringify(current)) } catch { /* Still applies for this session. */ }
    listeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(preferences.subscribe, preferences.get)
}
