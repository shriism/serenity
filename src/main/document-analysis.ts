import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import YAML from 'yaml'
import { Workspace } from './workspace'
import type { Autonomy, Provider, WorkspaceSnapshot } from '../shared/types'

type Send = (workspace: Workspace, input: { text: string; provider: Provider; autonomy: Autonomy; retained: boolean }) => Promise<WorkspaceSnapshot>

export async function analyzeChangedDocument(workspace: Workspace, filename: string, send: Send): Promise<void> {
  const snapshot = await workspace.snapshot()
  if (!snapshot.modules.documentAnalysis || !snapshot.documents.some((item) => item.name === filename)) return
  const path = join(workspace.directories[2], basename(filename))
  const hash = createHash('sha256').update(await readFile(path)).digest('hex')
  const statePath = join(workspace.path, '.serenity', 'analyzed-documents.yaml')
  let processed: Record<string, string> = {}
  try {
    const raw: unknown = YAML.parse(await readFile(statePath, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) processed = raw as Record<string, string>
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (processed[filename] === hash) return
  await send(workspace, {
    text: `Analyze the newly added or changed document named "${filename}". Extract useful entities, facts, tasks, and events as proposals, with the document name as their source. Ask for clarification if identities are ambiguous.`,
    provider: snapshot.semanticProvider, autonomy: 'propose', retained: true
  })
  processed[filename] = hash
  const temp = `${statePath}.${randomUUID()}.tmp`
  try { await writeFile(temp, YAML.stringify(processed), { flag: 'wx' }); await rename(temp, statePath) }
  catch (error) { await unlink(temp).catch(() => undefined); throw error }
}
