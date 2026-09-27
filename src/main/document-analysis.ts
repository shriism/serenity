import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import YAML from 'yaml'
import { Workspace } from './workspace'
import type { Autonomy, Provider, WorkspaceSnapshot } from '../shared/types'
import { documentAnalysisPrompt } from '../shared/analysis-prompt'

type Send = (workspace: Workspace, input: { text: string; provider: Provider; autonomy: Autonomy; retained: boolean; operation: 'document-analysis' }, signal?: AbortSignal) => Promise<WorkspaceSnapshot>

export async function analyzeChangedDocument(workspace: Workspace, filename: string, send: Send, signal?: AbortSignal): Promise<void> {
  const snapshot = await workspace.snapshot()
  if (!snapshot.modules.documentAnalysis || !snapshot.documents.some((item) => item.name === filename && item.extractable)) return
  const path = await workspace.documentPath(basename(filename))
  const hash = createHash('sha256').update(await readFile(path)).digest('hex')
  const statePath = join(workspace.path, '.serenity', 'analyzed-documents.yaml')
  let processed: Record<string, string> = {}
  try {
    const raw: unknown = YAML.parse(await workspace.readSettingsFile('analyzed-documents.yaml'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.entries(raw).some(([, value]) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
      throw new Error('Invalid document-analysis tracking; repair .serenity/analyzed-documents.yaml before retrying')
    }
    processed = raw as Record<string, string>
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (processed[filename] === hash) return
  if (signal?.aborted) throw new Error('AI request cancelled')
  await send(workspace, {
    text: documentAnalysisPrompt(filename, 'changed'),
    provider: snapshot.semanticProvider, autonomy: 'propose', retained: true, operation: 'document-analysis'
  }, signal)
  if (signal?.aborted) throw new Error('AI request cancelled')
  processed[filename] = hash
  const temp = `${statePath}.${randomUUID()}.tmp`
  try { await writeFile(temp, YAML.stringify(processed), { flag: 'wx' }); await rename(temp, statePath) }
  catch (error) { await unlink(temp).catch(() => undefined); throw error }
}
