import { watch, type FSWatcher } from 'node:fs'

// Workspace content the app reacts to when edited elsewhere. Provider activity and derived indexes are written by the
// app itself and are left out, so refreshing never triggers more refreshing.
const watchedFolders = new Set(['entities', 'claims', 'documents', 'conversations', 'proposals', 'calendar', 'tasks', 'resolutions', 'identity-decisions', 'pages', 'archive'])
const watchedSettings = new Set(['modules.yaml', 'semantic-provider.yaml', 'workbench.yaml'])

/** Whether a path relative to the workspace root, with either separator, is workspace content worth refreshing for. */
export function isWatchedPath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/).filter(Boolean)
  if (parts[0] === '.serenity') return parts.length === 2 && watchedSettings.has(parts[1])
  if (parts.length < 2 || !watchedFolders.has(parts[0])) return false
  const name = parts.at(-1)!
  // Temporary files from atomic writes and from editors that save by renaming.
  return !name.startsWith('.') && !name.endsWith('~') && !/\.[0-9a-f-]{36}\.tmp$/.test(name)
}

/**
 * Watches a workspace with one recursive watcher (one handle per tree on macOS and Windows, one per directory on
 * Linux) instead of one per file, so large workspaces do not exhaust file handles. Changes are collected until the
 * folder has been quiet for `quietMs`, then reported together, relative to the root.
 */
export function watchWorkspace(root: string, onChanges: (paths: string[]) => void, onError: (error: Error) => void, quietMs = 250): { close(): void } {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const paths = [...pending]
    pending.clear()
    if (paths.length) onChanges(paths)
  }
  let watcher: FSWatcher | null = watch(root, { recursive: true, persistent: true }, (_event, filename) => {
    const path = filename?.toString()
    if (!path || !isWatchedPath(path)) return
    pending.add(path)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, quietMs)
  })
  watcher.on('error', onError)
  return {
    close() {
      if (timer) clearTimeout(timer)
      timer = null
      pending.clear()
      watcher?.close()
      watcher = null
    }
  }
}
