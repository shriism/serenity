import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface RecentWorkspace { path: string; name: string; available: boolean }

const limit = 8

/**
 * Workspaces opened on this device, newest first, kept in the app's own settings folder rather than in any workspace.
 * Only paths the person chose through the folder picker (or at launch) are ever recorded, so reopening one from the
 * list never gives the renderer a way to name an arbitrary path.
 */
export class RecentWorkspaces {
  constructor(private file: string) {}

  private async read(): Promise<string[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, limit) : []
    } catch { return [] }
  }

  private async write(paths: string[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(paths, null, 2))
    await rename(temporary, this.file)
  }

  /** Records a workspace as the most recently opened. */
  async add(path: string): Promise<void> {
    const absolute = resolve(path)
    await this.write([absolute, ...(await this.read()).filter((item) => item !== absolute)].slice(0, limit))
  }

  async remove(path: string): Promise<void> {
    await this.write((await this.read()).filter((item) => item !== path))
  }

  /** Whether `path` is one of the recorded workspaces, exactly as listed. */
  async includes(path: string): Promise<boolean> {
    return (await this.read()).includes(path)
  }

  /** Recorded workspaces with whether each folder is still there, e.g. an unplugged drive shows as unavailable. */
  async list(): Promise<RecentWorkspace[]> {
    return Promise.all((await this.read()).map(async (path) => ({
      path, name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
      available: await stat(path).then((info) => info.isDirectory(), () => false)
    })))
  }
}
