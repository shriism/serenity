import { mkdir, rename, lstat } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Stands in for Electron's system Trash without touching the developer's Trash during unit tests. */
export function testTrash(workspace: string): (path: string) => Promise<void> {
  return async (source) => {
    const directory = join(workspace, '.test-system-trash')
    await mkdir(directory, { recursive: true })
    const name = basename(source)
    for (let count = 1; ; count++) {
      const target = join(directory, count === 1 ? name : `${count}-${name}`)
      try { await lstat(target) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await rename(source, target)
        return
      }
    }
  }
}
