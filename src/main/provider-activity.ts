import { createHash, randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import type { Provider, ProviderActivity } from '../shared/types'

export type ActivityRequest = { operation: ProviderActivity['operation']; refs: string[] }

export async function trackProviderCall<T>(
  workspacePath: string, provider: Provider, prompt: string, activity: ActivityRequest, run: () => Promise<T>
): Promise<T> {
  const entry: ProviderActivity = {
    id: randomUUID(), provider, operation: activity.operation, refs: activity.refs,
    promptCharacters: prompt.length, promptChecksum: createHash('sha256').update(prompt).digest('hex'),
    startedAt: new Date().toISOString(), status: 'running'
  }
  const path = join(workspacePath, 'activity', `${entry.id}.yaml`)
  await writeFile(path, YAML.stringify(entry), { flag: 'wx' })
  const update = async (): Promise<void> => {
    const temp = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temp, YAML.stringify(entry), { flag: 'wx' }); await rename(temp, path) }
    catch (error) { await unlink(temp).catch(() => undefined); throw error }
  }
  try {
    const result = await run()
    entry.status = 'completed'
    entry.finishedAt = new Date().toISOString()
    await update()
    return result
  } catch (error) {
    if (entry.status !== 'completed') {
      entry.status = 'failed'
      entry.error = error instanceof Error ? error.message : String(error)
      entry.finishedAt = new Date().toISOString()
      await update()
    }
    throw error
  }
}
