import { createHash, randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import type { ProviderActivity } from '../shared/types'

export type ActivityRequest = { operation: ProviderActivity['operation']; refs: string[]; conversationId?: string }

/** Records a provider call's references, size, checksum, timing, and outcome; the prompt text itself is not stored. */
export async function trackProviderCall<T>(
  workspacePath: string, provider: string, prompt: string, activity: ActivityRequest, run: () => Promise<T>,
  describe: (result: T) => Pick<ProviderActivity, 'model'> = () => ({})
): Promise<T> {
  const entry: ProviderActivity = {
    id: randomUUID(), provider, operation: activity.operation, refs: activity.refs, conversationId: activity.conversationId,
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
    Object.assign(entry, describe(result))
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
