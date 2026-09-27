import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isWatchedPath, watchWorkspace } from '../src/main/workspace-watcher'

test('only workspace content and editable settings count as changes', () => {
  for (const path of ['entities/a.md', 'claims\\b.yaml', 'pages/Home.md', 'archive/merges/history/x/y.yaml', 'documents/syllabus.pdf', '.serenity/workbench.yaml', '.serenity/modules.yaml'])
    assert.equal(isWatchedPath(path), true, path)
  for (const path of ['activity/x.yaml', '.serenity/index.sqlite', '.serenity/session.yaml', '.serenity/semantic-index.yaml', 'entities', 'notes/a.md',
    'entities/.a.md.swp', 'entities/a.md~', 'claims/b.yaml.123e4567-e89b-42d3-a456-426614174000.tmp'])
    assert.equal(isWatchedPath(path), false, path)
})

test('one recursive watcher reports a burst of changes together', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-watch-'))
  try {
    await mkdir(join(directory, 'entities'))
    await mkdir(join(directory, 'activity'))
    const batches: string[][] = []
    const watcher = watchWorkspace(directory, (paths) => batches.push(paths.sort()), (error) => { throw error }, 150)
    await new Promise((resolve) => setTimeout(resolve, 200))
    for (let index = 0; index < 20; index++) await writeFile(join(directory, 'entities', `e${index}.md`), 'x')
    await writeFile(join(directory, 'activity', 'ignored.yaml'), 'x')
    for (let attempt = 0; attempt < 40 && !batches.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 100))
    await new Promise((resolve) => setTimeout(resolve, 300))
    watcher.close()
    const seen = new Set(batches.flat().map((path) => path.replace(/\\/g, '/')))
    assert.equal(seen.has('entities/e0.md') && seen.has('entities/e19.md'), true)
    assert.equal([...seen].some((path) => path.startsWith('activity')), false)
    assert.ok(batches.length <= 3, `changes should arrive batched, got ${batches.length} batches`)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
