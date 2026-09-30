import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { testTrash } from './trash-helper'

test('removing an entity sends it and its facts to system Trash and refuses when others merged into it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-archive-entity-'))
  try {
    const workspace = new Workspace(directory, testTrash(directory))
    await workspace.initialize()
    let snapshot = await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: 'Notes' })
    const alex = snapshot.entities[0]
    snapshot = await workspace.saveEntity({ id: '', title: 'Sam', type: 'person', body: '' })
    const sam = snapshot.entities.find((entity) => entity.title === 'Sam')!
    await workspace.addClaim({ subject: alex.id, key: 'birthday', value: 'March 3', source: 'Me' })
    snapshot = await workspace.addClaim({ subject: sam.id, key: 'works with', value: alex.id, source: 'Me' })
    await assert.rejects(workspace.archiveEntity(alex.id, 'stale'), /changed on disk/)
    snapshot = await workspace.archiveEntity(alex.id, snapshot.entities.find((entity) => entity.id === alex.id)!.revision!)
    assert.equal(snapshot.entities.some((entity) => entity.id === alex.id), false)
    assert.equal(snapshot.claims.some((claim) => claim.subject === alex.id), false, 'its own facts leave the active workspace')
    assert.ok(snapshot.claims.some((claim) => claim.subject === sam.id && claim.value === alex.id), 'facts about others stay')
    assert.equal(snapshot.archivedEntities.find((entity) => entity.id === alex.id), undefined, 'removed entity is outside the workspace')
    assert.ok((await readdir(join(directory, '.test-system-trash'))).includes(`${alex.id}.md`))
    assert.equal((await readdir(join(directory, '.test-system-trash'))).filter((name) => name.endsWith('.yaml')).length, 1)
    // An entity others were merged into cannot be archived until those merges are undone.
    snapshot = await workspace.saveEntity({ id: '', title: 'Sam duplicate', type: 'person', body: '' })
    const duplicate = snapshot.entities.find((entity) => entity.title === 'Sam duplicate')!
    snapshot = await workspace.mergeEntities(duplicate.id, sam.id)
    await assert.rejects(workspace.archiveEntity(sam.id, snapshot.entities.find((entity) => entity.id === sam.id)!.revision!), /merged into this one/)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('removing a document uses system Trash without overwriting an earlier item', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-archive-document-'))
  try {
    const workspace = new Workspace(directory, testTrash(directory))
    await workspace.initialize()
    await writeFile(join(directory, 'documents', 'notes.md'), 'first')
    workspace.markDirty()
    let snapshot = await workspace.archiveDocument('notes.md')
    assert.equal(snapshot.documents.length, 0)
    await writeFile(join(directory, 'documents', 'notes.md'), 'second')
    workspace.markDirty()
    snapshot = await workspace.archiveDocument('notes.md')
    assert.deepEqual((await readdir(join(directory, '.test-system-trash'))).sort(), ['2-notes.md', 'notes.md'])
    await assert.rejects(workspace.archiveDocument('../escape.md'), /Invalid document name/)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('older workspace archives move to system Trash while merge history stays in place', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-legacy-trash-'))
  try {
    const workspace = new Workspace(directory, testTrash(directory))
    await workspace.initialize()
    await mkdir(join(directory, 'archive', 'tasks'), { recursive: true })
    await mkdir(join(directory, 'trash', 'calendar'), { recursive: true })
    await writeFile(join(directory, 'archive', 'tasks', 'old-task.yaml'), 'task bytes')
    await writeFile(join(directory, 'trash', 'calendar', 'old-event.yaml'), 'event bytes')
    await writeFile(join(directory, 'archive', 'merges', 'history', 'keep.yaml'), 'merge history')
    await workspace.migrateLegacyRemovals()
    assert.deepEqual((await readdir(join(directory, '.test-system-trash'))).sort(), ['old-event.yaml', 'old-task.yaml'])
    assert.equal(await readFile(join(directory, 'archive', 'merges', 'history', 'keep.yaml'), 'utf8'), 'merge history')
    assert.deepEqual((await workspace.snapshot()).errors, [])
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
